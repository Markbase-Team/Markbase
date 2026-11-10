import { getTicket, updateTicketCc } from "@markbase/protocol/tickets";
import { callerFromHeaders } from "@markbase/protocol/auth";
import type { TicketCommit } from "@markbase/protocol/types";

// POST /progress?ticket_id=xxx
// Called by a Claude Code session (run by a worker) to report progress:
//   - a commit:  { commit_title, commit_link }
//   - the PR:    { pr_title, pr_id, pr_link }
// Authenticated by the worker's API key (Authorization: Bearer …); the write is
// scoped to that key's owner, so a worker can only update its own tickets.
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });

  const ticketId = new URL(req.url).searchParams.get("ticket_id");
  if (!ticketId) {
    return Response.json({ error: "ticket_id is required" }, { status: 400 });
  }

  // Owner-scoped: returns the ticket only if it belongs to the caller.
  const ticket = await getTicket(ticketId, caller.ownerId);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  let body: {
    commit_title?: string;
    commit_link?: string;
    pr_title?: string;
    pr_id?: string;
    pr_link?: string;
    preview_url?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const str = (v: string | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  const patch: Parameters<typeof updateTicketCc>[1] = {};

  // Commit report — append to the existing list.
  const commitTitle = str(body.commit_title);
  if (commitTitle) {
    const commit: TicketCommit = {
      title: commitTitle,
      link: str(body.commit_link) ?? null,
      at: new Date().toISOString(),
    };
    patch.commits = [...(ticket.commits ?? []), commit];
  }

  // PR report.
  const prTitle = str(body.pr_title);
  const prId = str(body.pr_id);
  const prLink = str(body.pr_link);
  if (prTitle || prId || prLink) {
    if (prTitle) patch.pr_title = prTitle;
    if (prId) patch.pr_id = prId;
    if (prLink) patch.pr_url = prLink;
  }

  // Optional preview URL.
  const previewUrl = str(body.preview_url);
  if (previewUrl) patch.preview_url = previewUrl;

  if (Object.keys(patch).length === 0) {
    return Response.json(
      { error: "Provide commit_title and/or pr fields" },
      { status: 400 }
    );
  }

  await updateTicketCc(ticketId, patch);
  return Response.json({ ok: true });
}
