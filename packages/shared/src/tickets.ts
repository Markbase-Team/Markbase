import {
  type CcState,
  type McpConfig,
  type OwnerKind,
  type Ticket,
  type TicketCommit,
  type TicketStatus,
} from "./types";


// A JSONB key holding a per-ticket property value. Property ids are uuids;
// validating the shape keeps untrusted input out of order/filter path strings.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPropertyId(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

// Tickets that describe a defect get a `fix/` branch; everything else `feature/`.
const FIX_RE =
  /\b(fix|fixe[sd]|bug|bugs|broken|break(s|ing)?|error|errors|crash|crashe[sd]|regression|fail(s|ed|ing)?|incorrect|wrong|issue|issues|defect|hotfix|patch|typo)\b/i;

export function ticketBranchKind(
  ticket: Pick<Ticket, "title" | "description">
): "fix" | "feature" {
  return FIX_RE.test(`${ticket.title} ${ticket.description}`) ? "fix" : "feature";
}

// A kebab-case slug of the title, capped so branch names stay readable.
function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "ticket";
}

// The git branch a ticket's work belongs on. An explicit `base_branch` wins;
// otherwise a fresh, ticket-aligned branch — `feature/<slug>` or `fix/<slug>` —
// that the worker creates off main. A short id suffix keeps it unique and stable
// across re-runs even when two tickets share a title, so each ticket gets its
// own clean branch/PR instead of piling onto a shared long-running branch.
export function ticketBranch(
  ticket: Pick<Ticket, "id" | "title" | "description" | "base_branch">
): string {
  const explicit = ticket.base_branch?.trim();
  if (explicit) return explicit;
  return `${ticketBranchKind(ticket)}/${slugifyTitle(ticket.title)}-${ticket.id.slice(0, 6)}`;
}

export interface CreateProjectInput {
  slug: string;
  name: string;
  local_path: string;
  github_repo: string | null;
  owners?: string[];
  /** The auth user who owns this project. */
  owner_id: string;
}

// Properties seeded onto every new project so they're present by default, the
// way `status` is a built-in field on every ticket. The
// 20260604_default_priority_property migration backfills the same set onto
// projects that predate this.
export const DEFAULT_PROJECT_PROPERTIES: ReadonlyArray<{
  name: string;
  options: string[];
}> = [{ name: "Priority", options: ["Low", "Medium", "High"] }];

export interface UpdateProjectInput {
  /** New slug (rename). tickets.project cascades on update. */
  slug?: string;
  name?: string;
  github_repo?: string | null;
  local_path?: string | null;
  owners?: string[];
  /** Per-project MCP servers (null clears it). */
  mcp_config?: McpConfig | null;
}

export interface CreateProjectPropertyInput {
  project: string;
  name: string;
  options?: string[];
  default_value?: string;
  position?: number;
}

export interface UpdateProjectPropertyInput {
  name?: string;
  options?: string[];
  default_value?: string;
  position?: number;
}

export interface TicketFilter {
  project?: string;
  status?: TicketStatus;
  /** Assignee kind: "user" (the app owner) or "agent" (any agent session). */
  ownerKind?: OwnerKind;
  /** Narrow to one named agent session (agent_sessions.id). Implies "agent". */
  ownerSessionId?: string;
  /** Exclude tickets with status "done". */
  notDone?: boolean;
  /** Keep only tickets whose property (by id) equals this value. */
  propertyId?: string;
  propertyValue?: string;
  /** Sort by a property value (by id) instead of creation date. */
  sortPropertyId?: string;
  sortDir?: "asc" | "desc";
}

export interface CreateTicketInput {
  project: string;
  title: string;
  requester: string;
  description: string;
  images?: string[];
  /** Assignee. Defaults to "user" (the app owner) for the public intake path. */
  ownerKind?: OwnerKind;
  status?: TicketStatus;
  /** Branch to base the work on. Null/omitted means the repo default. */
  base_branch?: string | null;
  /** Initial property values, keyed by ProjectProperty.id. */
  properties?: Record<string, string>;
  /** A Claude session to resume on dispatch instead of starting fresh. */
  cc_seed_session_id?: string | null;
  /** The named agent session (agent_sessions.id) this ticket targets. */
  agentSessionId?: string | null;
}

// Resolve the two assignee columns from an owner intent. The agent assignee is a
// named agent session. "user" (or unset with no session) means the app owner and
// always clears the session; naming a session implies "agent". Shared by create +
// update so the two paths can't drift.
export function resolveOwnerFields(input: {
  ownerKind?: OwnerKind | null;
  agentSessionId?: string | null;
}): { owner_kind: OwnerKind; agent_session_id: string | null } {
  const kind: OwnerKind =
    input.ownerKind === "agent" || (!input.ownerKind && input.agentSessionId)
      ? "agent"
      : "user";
  return {
    owner_kind: kind,
    agent_session_id: kind === "agent" ? input.agentSessionId ?? null : null,
  };
}

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  requester?: string;
  /** Reassign the ticket. "user" clears the session; "agent" assigns one. */
  ownerKind?: OwnerKind;
  /** The named agent session (agent_sessions.id) when ownerKind is "agent". */
  agentSessionId?: string | null;
  status?: TicketStatus;
  images?: string[];
  /** Branch to work on. null clears it (a feature/… or fix/… branch is
   * generated from the ticket via {@link ticketBranch}). */
  base_branch?: string | null;
  /** Replace the per-property values map (keyed by ProjectProperty.id). */
  properties?: Record<string, string>;
  /** Toggle commit-after-each-change + PR for the Claude Code session. */
  auto_commit?: boolean;
}

export interface TicketCcPatch {
  cc_state?: string;
  cc_session_id?: string | null;
  cc_summary?: string | null;
  cc_last_run?: string | null;
  cc_branch?: string | null;
  commits?: TicketCommit[];
  pr_title?: string | null;
  pr_id?: string | null;
  pr_url?: string | null;
  preview_url?: string | null;
}

const CC_STATES: readonly CcState[] = ["idle", "queued", "running", "done", "error"];

export function isCcState(v: string | null | undefined): v is CcState {
  return typeof v === "string" && (CC_STATES as readonly string[]).includes(v);
}

/** What a PATCH /tickets/:id body may carry for the run-tracking fields. */
export interface TicketCcPatchBody {
  cc_state?: string;
  cc_session_id?: string | null;
  cc_summary?: string | null;
  cc_last_run?: string | null;
  cc_branch?: string | null;
  commits?: Array<{ title?: string; link?: string | null; at?: string }>;
  pr_title?: string | null;
  pr_id?: string | null;
  pr_url?: string | null;
  preview_url?: string | null;
}

/** A string, or null to clear; anything else is left alone (undefined). */
function nullableString(v: string | null | undefined): string | null | undefined {
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
}

/**
 * The run-tracking patch a request body asks for, validated field by field —
 * the worker reports progress onto its ticket through the API now, and the
 * API must not pass a body through to the database unread. Unknown keys and
 * ill-typed values are dropped; an invalid cc_state is reported so the caller
 * learns about it rather than silently keeping the old state.
 */
export function ticketCcPatchFrom(
  body: TicketCcPatchBody
): { ok: true; patch: TicketCcPatch } | { ok: false; error: string } {
  const patch: TicketCcPatch = {};
  if (body.cc_state !== undefined) {
    if (!isCcState(body.cc_state)) return { ok: false, error: "Invalid cc_state" };
    patch.cc_state = body.cc_state;
  }
  const strings = [
    "cc_session_id",
    "cc_summary",
    "cc_last_run",
    "cc_branch",
    "pr_title",
    "pr_id",
    "pr_url",
    "preview_url",
  ] as const;
  for (const key of strings) {
    const v = nullableString(body[key]);
    if (v !== undefined) patch[key] = v;
  }
  if (Array.isArray(body.commits)) {
    patch.commits = body.commits
      .filter((c): c is { title: string; link?: string | null; at?: string } =>
        !!c && typeof c === "object" && typeof c.title === "string"
      )
      .map((c) => ({
        title: c.title,
        link: typeof c.link === "string" ? c.link : null,
        ...(typeof c.at === "string" ? { at: c.at } : {}),
      }));
  }
  return { ok: true, patch };
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  role: "user" | "assistant";
  content: string;
  /** Attached image/PDF URLs (public ticket-images bucket). */
  images: string[];
  created_at: string;
}
