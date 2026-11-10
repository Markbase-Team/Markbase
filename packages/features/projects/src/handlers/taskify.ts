import { chatJson } from "@markbase/llm";
import {
  createTicket,
  getProject,
  listProjectProperties,
  listTicketsInRange,
  updateProject,
} from "@markbase/protocol/tickets";
import {
  isStatus,
  STATUS_LABELS,
  type McpConfig,
  type Ticket,
  type TicketStatus,
} from "@markbase/protocol/types";
import { owner, type HandlerHost } from "./host";

// The three endpoints that are about a project as a whole rather than one
// ticket: turning a note into a ticket, its MCP config, and the period summary.

/**
 * What the model returns from a taskify call. `properties` is keyed by the
 * property's human NAME (not its uuid) so the prompt can stay readable; the
 * names are mapped to ids below.
 */
type Extracted = {
  title?: string;
  description?: string;
  properties?: Record<string, string>;
};

export function projectTaskifyHandler(host: HandlerHost) {
  const { json } = host;
  // POST { text } — "taskify" a work-log block: a small model extracts a
  // ticket's fields (title, description, and any project properties like
  // Priority) from the block text, then we create the ticket. Anything the
  // model can't infer is left empty — we never invent details. Falls back to
  // using the raw text as the title if the model is unavailable.
  return async (req: Request, slug: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    if (!(await getProject(slug, a.ownerId))) {
      return json({ error: "Unknown project" }, 404);
    }

    let body: { text?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return json({ error: "text is required" }, 400);

    const props = await listProjectProperties(slug, a.ownerId);

    // Describe the project's custom properties so the model fills only valid
    // values (and leaves the rest blank).
    const propGuide = props
      .map((p) => {
        const opts = p.options.length
          ? ` — must be one of: ${p.options.join(", ")}`
          : "";
        return `  - ${p.name}${opts}`;
      })
      .join("\n");

    const system = [
      "You convert a short work-log note into a project ticket by extracting structured fields.",
      "Only use information explicitly present in the note. If a field can't be determined, return an empty string for it — never invent details.",
      "",
      "Fields:",
      "  - title: a concise ticket title. If the note is already a short phrase, use it as-is.",
      "  - description: any extra detail beyond the title; empty string if the note has none.",
      props.length
        ? `Custom properties (return under "properties", keyed by the exact property name shown):\n${propGuide}`
        : "",
      "",
      'Respond with JSON only: { "title": string, "description": string, "properties": { "<name>": "<value>" } }',
    ]
      .filter(Boolean)
      .join("\n");

    const extracted = await chatJson<Extracted>([
      { role: "system", content: system },
      { role: "user", content: text },
    ]);

    // Title always resolves (raw text is the floor); description may be empty.
    const title = (extracted?.title?.trim() || text).slice(0, 200);
    const description = extracted?.description?.trim() || "";

    // Map extracted property values (keyed by name) onto property ids, dropping
    // anything that isn't one of the property's allowed options.
    const properties: Record<string, string> = {};
    const byName = extracted?.properties ?? {};
    for (const p of props) {
      const raw = byName[p.name];
      if (typeof raw !== "string") continue;
      const value = raw.trim();
      if (!value) continue;
      if (p.options.length && !p.options.includes(value)) continue;
      properties[p.id] = value;
    }

    const ticket = await createTicket({
      project: slug,
      title,
      description,
      requester: "markbase",
      status: "requested",
      properties: Object.keys(properties).length ? properties : undefined,
    });

    return json({ ticket }, 201);
  };
}

export function projectMcpHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET — the project's MCP config (with ${SECRET} refs; never any secret
    // values, which live in the Secrets vault).
    GET: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;
      const project = await getProject(slug, a.ownerId);
      if (!project) return json({ error: "Unknown project" }, 404);
      return json({ mcp_config: project.mcp_config ?? null });
    },

    // PATCH { mcp_config } — replace it (null clears).
    PATCH: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;

      let body: { mcp_config?: McpConfig | null } = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const cfg = body.mcp_config;
      if (
        cfg !== null &&
        (typeof cfg !== "object" ||
          Array.isArray(cfg) ||
          typeof cfg.mcpServers !== "object" ||
          cfg.mcpServers === null)
      ) {
        return json(
          { error: 'Expected null or an object with an "mcpServers" object.' },
          400
        );
      }

      const updated = await updateProject(
        slug,
        { mcp_config: cfg ?? null },
        a.ownerId
      );
      if (!updated) return json({ error: "Unknown project" }, 404);
      return json({ mcp_config: updated.mcp_config ?? null });
    },
  };
}

/** Compact, model-friendly rendering of each ticket's facts. */
function ticketsToContext(tickets: Ticket[]): string {
  return tickets
    .map((t, i) => {
      const lines = [
        `${i + 1}. [${t.project}] ${t.title}`,
        `   status: ${STATUS_LABELS[t.status]}`,
        `   requester: ${t.requester}`,
        `   updated: ${t.updated_at}`,
        `   description: ${t.description.replace(/\s+/g, " ").slice(0, 500)}`,
      ];
      if (t.pr_url) lines.push(`   pr: #${t.pr_id ?? ""} ${t.pr_url}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** Deterministic markdown used as the fallback (and when there are no tickets). */
function buildStructured(
  tickets: Ticket[],
  from: string,
  to: string,
  statuses: TicketStatus[],
  project?: string
): string {
  const scope = project ? ` · ${project}` : "";
  const statusNames = statuses.map((s) => STATUS_LABELS[s]).join(", ");
  const header = `# Ticket summary — ${from} to ${to}${scope}\n\n_Statuses: ${statusNames}_\n`;
  if (tickets.length === 0) {
    return `${header}\n_No matching tickets in this period._\n`;
  }

  const byProject = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const arr = byProject.get(t.project) ?? [];
    arr.push(t);
    byProject.set(t.project, arr);
  }

  const sections = [...byProject.entries()].map(([proj, items]) => {
    const rows = items
      .map((t) => {
        const pr = t.pr_url ? ` ([PR #${t.pr_id ?? ""}](${t.pr_url}))` : "";
        const desc = t.description.replace(/\s+/g, " ").slice(0, 200);
        return `- **[${STATUS_LABELS[t.status]}]** ${t.title}${pr} — ${desc}`;
      })
      .join("\n");
    return `## ${proj}\n\n${rows}`;
  });

  return `${header}\n${tickets.length} ticket(s).\n\n${sections.join("\n\n")}\n`;
}

export function summaryHandler(host: HandlerHost) {
  const { json } = host;
  // POST { from, to, statuses?, project? } — summarize the tickets in the given
  // statuses within [from, to] as editable markdown. Uses the LLM for a
  // narrative; falls back to a structured list if it's unavailable.
  return async (req: Request): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    let body: {
      from?: string;
      to?: string;
      statuses?: string[];
      project?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const from = typeof body.from === "string" ? body.from : "";
    const to = typeof body.to === "string" ? body.to : "";
    if (!from || !to) {
      return json({ error: "from and to dates are required" }, 400);
    }
    // Validate the requested statuses; default to "done" when none are given.
    const statuses: TicketStatus[] = Array.isArray(body.statuses)
      ? body.statuses.filter(isStatus)
      : [];
    if (statuses.length === 0) statuses.push("done");

    // `to` is a date (YYYY-MM-DD); include the whole day by reaching its end.
    const toEnd = to.length === 10 ? `${to}T23:59:59.999Z` : to;
    const project = body.project?.trim() || undefined;

    const tickets = await listTicketsInRange(
      a.ownerId,
      from,
      toEnd,
      statuses,
      project
    );
    const structured = buildStructured(tickets, from, to, statuses, project);

    if (tickets.length === 0) return json({ summary: structured, count: 0 });

    const statusNames = statuses.map((s) => STATUS_LABELS[s]).join(", ");

    // Ask the model for a narrative; fall back to the structured list on any
    // failure (no API key, rate limit, unparseable output).
    let summary = structured;
    try {
      const result = await chatJson<{ summary?: string }>([
        {
          role: "system",
          content:
            "You write concise progress reports in GitHub-flavored markdown. " +
            "Given a list of tickets, write a summary that groups work by " +
            "project (## headings). Each ticket is a bullet that MUST begin with " +
            "its status as a bold tag, e.g. `- **[Need review]** <title> — " +
            "<what was done or is pending>`. Link PRs as [PR #<id>](<url>) when " +
            "present. Start with a one-line overview. " +
            'Respond as JSON: {"summary": "<markdown>"}.',
        },
        {
          role: "user",
          content: `Period: ${from} to ${to}. Statuses: ${statusNames}. ${tickets.length} ticket(s).\n\n${ticketsToContext(tickets)}`,
        },
      ]);
      if (result?.summary?.trim()) summary = result.summary.trim();
    } catch {
      // keep the structured fallback
    }

    return json({ summary, count: tickets.length });
  };
}
