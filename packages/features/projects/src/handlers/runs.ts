import { cancelTicketJobs, createJob, hasPendingJob } from "@markbase/protocol/jobs";
import {
  addMessage,
  getProject,
  getTicket,
  ticketBranch,
  updateTicket,
  updateTicketCc,
} from "@markbase/protocol/tickets";
import { CLAUDE_CODE_REQUIRED, featureEnabled } from "@markbase/node/features";
import { getRepoState } from "@markbase/node/repo-state";
import { resolvePreviewUrl } from "@markbase/node/vercel-preview";
import { owner, type HandlerHost } from "./host";

// Handing a ticket to an agent, and everything that follows from it: the run,
// a follow-up message, cancelling, and reading the PR and preview back.

export function ticketDispatchHandler(host: HandlerHost) {
  const { json } = host;
  // POST — enqueue a Claude Code run for the local worker. The worker executes
  // it against the project's local repo. This endpoint never runs claude
  // itself, so it works whether the web app is local or deployed.
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const ticket = await getTicket(id, a.ownerId);
    if (!ticket) return json({ error: "Ticket not found" }, 404);
    if (ticket.owner_kind !== "agent") {
      return json({ error: "Assign the ticket to an agent first" }, 400);
    }
    // The last line of defence: a job here becomes `claude` running on a machine.
    if (!(await featureEnabled("ticketDispatch", a.ownerId))) {
      return json({ error: CLAUDE_CODE_REQUIRED }, 403);
    }
    if (ticket.cc_state === "queued" || ticket.cc_state === "running") {
      return json(
        { error: "A run is already queued or in progress for this ticket" },
        409
      );
    }
    if (await hasPendingJob(id)) {
      return json({ error: "A job is already pending for this ticket" }, 409);
    }

    const project = await getProject(ticket.project, a.ownerId);
    if (!project?.local_path) {
      return json({ error: "This project has no local repo path" }, 400);
    }

    // Reset prior run output and mark queued for the worker. The branch the
    // worker commits on is the ticket's explicit base_branch, or a fresh
    // ticket-aligned branch (feature/… or fix/…) created off main — so each
    // ticket gets its own clean branch and PR.
    await updateTicketCc(id, {
      cc_state: "queued",
      cc_summary: null,
      cc_branch: ticketBranch(ticket),
      cc_last_run: new Date().toISOString(),
      commits: [],
      pr_title: null,
      pr_id: null,
      pr_url: null,
    });
    // Status is left untouched — the board is moved manually. Dispatching only
    // enqueues the run (cc_state: "queued"); it doesn't flip the column.
    await createJob(id, "dispatch");

    return json({ ok: true, cc_state: "queued" });
  };
}

export function ticketCancelHandler(host: HandlerHost) {
  const { json } = host;
  // POST — stop a queued or running Claude Code run. Queued: the pending job is
  // cancelled before the worker claims it. Running: the job is marked cancelled
  // and the worker (which polls its job) kills the subprocess. Either way the
  // ticket is reset so it can be re-run.
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const ticket = await getTicket(id, a.ownerId);
    if (!ticket) return json({ error: "Ticket not found" }, 404);
    if (ticket.cc_state !== "queued" && ticket.cc_state !== "running") {
      return json(
        { error: "Nothing to cancel — the ticket isn't queued or running" },
        409
      );
    }

    await cancelTicketJobs(id);

    // Reset the run state so the board unblocks immediately (Realtime picks
    // this up). Send it back to the backlog so it can be dispatched again.
    await updateTicketCc(id, {
      cc_state: "idle",
      cc_summary: null,
      cc_last_run: new Date().toISOString(),
    });
    await updateTicket(id, { status: "requested" }, a.ownerId);

    return json({ ok: true, cc_state: "idle" });
  };
}

export function ticketChatHandler(host: HandlerHost) {
  const { json } = host;
  // POST { message } — queue a follow-up for the ticket's Claude Code session.
  // The local worker resumes the session and runs it — same queue as the
  // initial dispatch, so follow-ups are serialized behind any in-flight run.
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const ticket = await getTicket(id, a.ownerId);
    if (!ticket) return json({ error: "Ticket not found" }, 404);
    if (!ticket.cc_session_id) {
      return json(
        { error: "No Claude Code session to resume — run the ticket first" },
        400
      );
    }

    let body: { message?: string; images?: string[] } = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const images = Array.isArray(body.images)
      ? body.images.filter(
          (u): u is string => typeof u === "string" && /^https?:\/\//.test(u)
        )
      : [];
    if (!message && images.length === 0) {
      return json({ error: "message or images is required" }, 400);
    }

    // Record the follow-up and enqueue it. Only surface "queued" when nothing
    // is already in flight — if a run is active, the job simply waits its turn
    // and the current run keeps its state.
    await addMessage(id, "user", message, images);
    if (ticket.cc_state !== "running" && ticket.cc_state !== "queued") {
      await updateTicketCc(id, {
        cc_state: "queued",
        cc_last_run: new Date().toISOString(),
      });
    }
    await createJob(id, "chat", { message, images });

    return json({ ok: true, cc_state: "queued" });
  };
}

export function ticketReviewHandler(host: HandlerHost) {
  const { json } = host;
  // POST — check GitHub for a review request on the ticket's open PR and, if
  // one is pending, move the ticket to "review_requested". Mirrors the preview
  // route: it reads live state via the `gh` CLI in the project's local repo, so
  // no Vercel/GitHub token is needed here.
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const ticket = await getTicket(id, a.ownerId);
    if (!ticket) return json({ error: "Ticket not found" }, 404);

    const project = await getProject(ticket.project, a.ownerId);
    if (!project?.local_path) {
      return json({ error: "This project has no local repo path" }, 400);
    }

    const branch = ticket.cc_branch ?? "auto";
    const state = await getRepoState(project.local_path, branch);
    if (!state || !state.pr_id) {
      return json({ error: "No open PR found for this ticket" }, 404);
    }

    // Keep the PR/commit fields fresh while we're here (cheap; we already paid
    // for the gh lookup) so the board reflects the open PR even on first sync.
    await updateTicketCc(id, {
      commits: state.commits,
      pr_id: state.pr_id,
      pr_title: state.pr_title,
      pr_url: state.pr_url,
    });

    // A pending review request moves the ticket to "review_requested". If none
    // is pending we leave the status alone (the reviewer may have responded).
    if (state.review_requested) {
      await updateTicket(id, { status: "review_requested" }, a.ownerId);
    }

    return json({
      review_requested: state.review_requested ?? false,
      status: state.review_requested ? "review_requested" : ticket.status,
      pr_id: state.pr_id,
    });
  };
}

export function ticketPreviewHandler(host: HandlerHost) {
  const { json } = host;
  // POST — look up the ticket's Vercel preview URL (from the GitHub deployment
  // for its branch) and store it on the ticket.
  return async (req: Request, id: string): Promise<Response> => {
    const a = await owner(req, "write", host);
    if ("error" in a) return a.error;

    const ticket = await getTicket(id, a.ownerId);
    if (!ticket) return json({ error: "Ticket not found" }, 404);

    const project = await getProject(ticket.project, a.ownerId);
    if (!project?.local_path) {
      return json({ error: "This project has no local repo path" }, 400);
    }

    const branch = ticket.cc_branch ?? "auto";
    const url = await resolvePreviewUrl(project.local_path, branch);
    if (!url) {
      return json(
        { error: "No preview found yet — Vercel may still be building" },
        404
      );
    }

    await updateTicketCc(id, { preview_url: url });
    return json({ preview_url: url });
  };
}
