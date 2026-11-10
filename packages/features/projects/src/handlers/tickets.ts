import { listAgentSessions } from "@markbase/protocol";
import {
  addMessage,
  deleteTicket,
  getProjectProperty,
  getTicket,
  isPropertyId,
  listMessages,
  listProjectProperties,
  listTickets,
  setTicketProperty,
  ticketCcPatchFrom,
  updateTicket,
  updateTicketCc,
  type TicketCcPatchBody,
} from "@markbase/protocol/tickets";
import { isOwnerKind, isStatus } from "@markbase/protocol/types";
import { CLAUDE_CODE_REQUIRED, featureEnabled } from "@markbase/node/features";
import { owner, type HandlerHost } from "./host";

export function ticketsHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET ?project=&status=&owner=&prop=&value=&sort=&dir= — all tickets,
    // optionally filtered by project, status, owner and a property's value, and
    // optionally sorted by a property.
    GET: async (req: Request): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;

      const { searchParams } = new URL(req.url);
      const project = searchParams.get("project") ?? undefined;
      const status = searchParams.get("status");
      const ownerKind = searchParams.get("ownerKind");
      const ownerSessionId = searchParams.get("ownerSessionId");
      const prop = searchParams.get("prop");
      const value = searchParams.get("value");
      const sort = searchParams.get("sort");
      const dir = searchParams.get("dir");

      // "not_done" is a special filter (everything except done).
      if (status && status !== "not_done" && !isStatus(status)) {
        return json({ error: "Invalid status" }, 400);
      }
      if (ownerKind && !isOwnerKind(ownerKind)) {
        return json({ error: "Invalid owner kind" }, 400);
      }

      const filterByValue = isPropertyId(prop) && !!value;

      const tickets = await listTickets(a.ownerId, {
        project: project || undefined,
        status: isStatus(status) ? status : undefined,
        notDone: status === "not_done",
        ownerKind: isOwnerKind(ownerKind) ? ownerKind : undefined,
        ownerSessionId: ownerSessionId || undefined,
        propertyId: filterByValue ? prop : undefined,
        propertyValue: filterByValue ? value : undefined,
        sortPropertyId: isPropertyId(sort) ? sort : undefined,
        sortDir: dir === "desc" ? "desc" : "asc",
      });

      return json({ tickets });
    },
  };
}

export function ticketHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET — a single ticket, plus its resolved Priority value (work-log ticket
    // chips read this to render live status/priority).
    GET: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;

      const ticket = await getTicket(id, a.ownerId);
      if (!ticket) return json({ error: "Ticket not found" }, 404);

      // Resolve the project's "Priority" property (if any) to a plain string.
      const props = await listProjectProperties(ticket.project, a.ownerId);
      const priorityProp = props.find((p) => p.name.toLowerCase() === "priority");
      const priority = priorityProp
        ? (ticket.properties?.[priorityProp.id] ?? "")
        : "";

      return json({ ticket, priority });
    },

    // PATCH — update any field, including the ones requesters cannot touch
    // (owner, status), and the run-tracking fields (cc_*, commits, the PR,
    // the preview) the worker reports as a run progresses.
    PATCH: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;

      if (!(await getTicket(id, a.ownerId))) {
        return json({ error: "Ticket not found" }, 404);
      }

      let body: {
        title?: string;
        requester?: string;
        description?: string;
        ownerKind?: string;
        agentSessionId?: string | null;
        status?: string;
        images?: string[];
        base_branch?: string | null;
        properties?: Record<string, string>;
        auto_commit?: boolean;
      } & TicketCcPatchBody = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      // The worker's half: progress onto the ticket. Validated field by field,
      // and written only after the ownership check above — the worker used to
      // update the row directly, and this is the one place that now may.
      const cc = ticketCcPatchFrom(body);
      if (!cc.ok) return json({ error: cc.error }, 400);
      if (Object.keys(cc.patch).length > 0) await updateTicketCc(id, cc.patch);

      const {
        title,
        requester,
        description,
        ownerKind,
        agentSessionId,
        status,
        images,
        base_branch,
        properties,
        auto_commit,
      } = body;

      // A ticket may only be assigned to an agent session the caller owns.
      let sessionId: string | null | undefined;
      if (isOwnerKind(ownerKind)) {
        if (ownerKind === "agent") {
          if (typeof agentSessionId !== "string") {
            return json({ error: "Pick an agent session to assign to" }, 400);
          }
          if (!(await featureEnabled("ticketDispatch", a.ownerId))) {
            return json({ error: CLAUDE_CODE_REQUIRED }, 403);
          }
          const owned = (await listAgentSessions(a.ownerId)).some(
            (s) => s.id === agentSessionId
          );
          if (!owned) return json({ error: "Unknown agent session" }, 400);
          sessionId = agentSessionId;
        } else {
          sessionId = null;
        }
      }

      const imageUrls = Array.isArray(images)
        ? images.filter(
            (u): u is string => typeof u === "string" && /^https?:\/\//.test(u)
          )
        : undefined;

      // base_branch: a trimmed string sets it; null/"" clears it; absent leaves it.
      const baseBranch =
        base_branch === undefined
          ? undefined
          : typeof base_branch === "string" && base_branch.trim()
            ? base_branch.trim()
            : null;

      const updated = await updateTicket(
        id,
        {
          title: typeof title === "string" ? title.trim() : undefined,
          requester: typeof requester === "string" ? requester.trim() : undefined,
          description:
            typeof description === "string" ? description.trim() : undefined,
          ownerKind: isOwnerKind(ownerKind) ? ownerKind : undefined,
          agentSessionId: sessionId,
          status: isStatus(status) ? status : undefined,
          images: imageUrls,
          base_branch: baseBranch,
          properties:
            properties && typeof properties === "object" ? properties : undefined,
          auto_commit: typeof auto_commit === "boolean" ? auto_commit : undefined,
        },
        a.ownerId
      );

      return json({ ticket: updated });
    },

    // DELETE — remove any ticket.
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;
      if (!(await getTicket(id, a.ownerId))) {
        return json({ error: "Ticket not found" }, 404);
      }
      await deleteTicket(id, a.ownerId);
      return json({ ok: true });
    },
  };
}

export function ticketPropertiesHandler(host: HandlerHost) {
  const { json } = host;
  // PATCH — set (or clear) one property value on a ticket. Body:
  // { property_id, value }. An empty value clears it.
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const ticket = await getTicket(id, a.ownerId);
    if (!ticket) return json({ error: "Ticket not found" }, 404);

    let body: { property_id?: string; value?: string } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    if (!isPropertyId(body.property_id)) {
      return json({ error: "property_id is required" }, 400);
    }

    // The property must belong to the ticket's project.
    const property = await getProjectProperty(body.property_id, a.ownerId);
    if (!property || property.project !== ticket.project) {
      return json(
        { error: "Property does not belong to this ticket's project" },
        400
      );
    }

    const value = typeof body.value === "string" ? body.value : "";

    // When the property restricts values to a fixed set, reject anything else
    // (an empty value is always allowed — it clears the field).
    if (
      property.options.length > 0 &&
      value.trim() &&
      !property.options.includes(value.trim())
    ) {
      return json(
        { error: `Value must be one of: ${property.options.join(", ")}` },
        400
      );
    }

    return json({
      ticket: await setTicketProperty(id, body.property_id, value, a.ownerId),
    });
  };
}

export function ticketMessagesHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET — the follow-up conversation thread.
    GET: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;
      if (!(await getTicket(id, a.ownerId))) {
        return json({ error: "Ticket not found" }, 404);
      }
      return json({ messages: await listMessages(id) });
    },

    // POST { role?, content } — add a message to the thread without starting a
    // run. The worker posts a run's summary here as the assistant's turn; a
    // follow-up that should resume the session goes through /chat instead.
    POST: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;
      if (!(await getTicket(id, a.ownerId))) {
        return json({ error: "Ticket not found" }, 404);
      }
      let body: { role?: string; content?: string } = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const role = body.role ?? "assistant";
      if (role !== "assistant" && role !== "user") {
        return json({ error: "role must be 'assistant' or 'user'" }, 400);
      }
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content) return json({ error: "content is required" }, 400);
      await addMessage(id, role, content);
      return json({ ok: true }, 201);
    },
  };
}
