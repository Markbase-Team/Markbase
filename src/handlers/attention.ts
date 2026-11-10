import type { Authorize } from "@markbase/protocol/caller";
import {
  listBoards,
  createBoard,
  updateBoard,
  deleteBoard,
  listItems,
  listFiledMessageIds,
  updateItem,
  reorderItems,
  deleteItem,
  clearBoard,
  restoreItems,
  classifyEmail,
  applyDismissFeedback,
  applyMoveFeedback,
  type BoardInput,
  type ClassifyInput,
  type ItemPatch,
  type AttentionPriority,
  type AttentionItem,
} from "../server/attention";

function isPriority(v: string): v is AttentionPriority {
  return v === "high" || v === "medium" || v === "low";
}

// Route-handler factories for the Attention API. The host app injects how it
// resolves the caller, so the package stays framework-agnostic and each handler
// returns a standard Web `Response`.
//
// Every handler takes the request first, even when it reads no body: that is
// what lets one host serve both credentials — the bearer token rides on these
// headers, and the host reads its own session from ambient state.

export type { Authorize };

function fail(e: Error | string): Response {
  const message = e instanceof Error ? e.message : e;
  return Response.json({ error: message }, { status: 500 });
}

// GET — boards + items in one payload (the page renders both).
export function attentionBoardsHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "read");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
    try {
      const [boards, items] = await Promise.all([listBoards(), listItems()]);
      return Response.json({ boards, items });
    } catch (e) {
      return fail(e instanceof Error ? e : "Request failed");
    }
  };
}

// GET — message ids already filed onto a board (for Inbox row flags).
export function attentionFiledHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "read");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
    try {
      return Response.json({ messageIds: await listFiledMessageIds() });
    } catch (e) {
      return fail(e instanceof Error ? e : "Request failed");
    }
  };
}

// POST { name, color?, sender_domains?, keywords?, rules?, position? }
export function attentionCreateBoardHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
    let body: Partial<BoardInput> = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.name || !body.name.trim()) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }
    try {
      return Response.json({ board: await createBoard(body as BoardInput) });
    } catch (e) {
      return fail(e instanceof Error ? e : "Request failed");
    }
  };
}

// PATCH /:id — update board fields. DELETE /:id — remove board (+ its items).
export function attentionBoardHandler(authorize: Authorize) {
  return {
    PATCH: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      let body: Partial<BoardInput> = {};
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      try {
        return Response.json({ board: await updateBoard(id, body) });
      } catch (e) {
        return fail(e instanceof Error ? e : "Request failed");
      }
    },
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      try {
        await deleteBoard(id);
        return Response.json({ ok: true });
      } catch (e) {
        return fail(e instanceof Error ? e : "Request failed");
      }
    },
  };
}

// PATCH /:id { status?, board_id?, priority? } — approve (optionally with a
// priority), move to another board, or change priority. DELETE /:id — dismiss.
export function attentionItemHandler(authorize: Authorize) {
  return {
    PATCH: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      let body: {
        status?: string;
        board_id?: string;
        priority?: string | null;
      } = {};
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "Invalid JSON" }, { status: 400 });
      }
      const patch: ItemPatch = {};
      if (body.board_id) patch.board_id = body.board_id;
      if (body.status === "filed" || body.status === "needs_approval") {
        patch.status = body.status;
      }
      if (body.priority === null) patch.priority = null;
      else if (typeof body.priority === "string" && isPriority(body.priority)) {
        patch.priority = body.priority;
      }
      try {
        return Response.json({ item: await updateItem(id, patch) });
      } catch (e) {
        return fail(e instanceof Error ? e : "Request failed");
      }
    },
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      try {
        await deleteItem(id);
        return Response.json({ ok: true });
      } catch (e) {
        return fail(e instanceof Error ? e : "Request failed");
      }
    },
  };
}

// POST { from, subject, snippet, summary?, reason, fromBoardId? } — the user
// dismissed an email and said why; the model revises a board or creates one.
export function attentionFeedbackHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
    let body: {
      from?: string;
      subject?: string;
      snippet?: string;
      summary?: string;
      reason?: string;
      fromBoardId?: string | null;
    } = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.reason || !body.reason.trim()) {
      return Response.json({ error: "reason is required" }, { status: 400 });
    }
    try {
      const result = await applyDismissFeedback({
        from: body.from ?? "",
        subject: body.subject ?? "",
        snippet: body.snippet ?? "",
        summary: body.summary,
        reason: body.reason,
        fromBoardId: body.fromBoardId ?? null,
      });
      return Response.json(result);
    } catch (e) {
      return fail(e instanceof Error ? e : "Request failed");
    }
  };
}

// POST /:id/clear — remove every item from a board (undoable via restore).
export function attentionClearBoardHandler(authorize: Authorize) {
  return async (req: Request, boardId: string): Promise<Response> => {
    const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
    try {
      await clearBoard(boardId);
      return Response.json({ ok: true });
    } catch (e) {
      return fail(e instanceof Error ? e : "Request failed");
    }
  };
}

// POST { items } — re-insert previously-removed items (undo a clear/dismiss).
export function attentionRestoreHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
    let body: { items?: AttentionItem[] } = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    try {
      await restoreItems(body.items ?? []);
      return Response.json({ ok: true });
    } catch (e) {
      return fail(e instanceof Error ? e : "Request failed");
    }
  };
}

// POST { from, subject, snippet, summary?, reason?, fromBoardId, toBoardId } —
// the user dragged an email between boards; tune both boards' rules.
export function attentionMoveFeedbackHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
    let body: {
      from?: string;
      subject?: string;
      snippet?: string;
      summary?: string;
      reason?: string;
      fromBoardId?: string;
      toBoardId?: string;
    } = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.fromBoardId || !body.toBoardId) {
      return Response.json(
        { error: "fromBoardId and toBoardId are required" },
        { status: 400 }
      );
    }
    try {
      const result = await applyMoveFeedback({
        from: body.from ?? "",
        subject: body.subject ?? "",
        snippet: body.snippet ?? "",
        summary: body.summary,
        reason: body.reason,
        fromBoardId: body.fromBoardId,
        toBoardId: body.toBoardId,
      });
      return Response.json(result);
    } catch (e) {
      return fail(e instanceof Error ? e : "Request failed");
    }
  };
}

// POST { boardId, orderedIds } — persist a board's card order after a drag.
export function attentionReorderHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
    let body: { boardId?: string; orderedIds?: string[] } = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.boardId || !Array.isArray(body.orderedIds)) {
      return Response.json(
        { error: "boardId and orderedIds are required" },
        { status: 400 }
      );
    }
    try {
      await reorderItems(body.boardId, body.orderedIds);
      return Response.json({ ok: true });
    } catch (e) {
      return fail(e instanceof Error ? e : "Request failed");
    }
  };
}

// POST { account_id?, message_id, thread_id?, from, subject, snippet, date? }
// Classifies the dropped email and files it. Returns the outcome so the client
// can toast (filed) or open the board for approval (needs_approval).
export function attentionClassifyHandler(authorize: Authorize) {
  return async (req: Request): Promise<Response> => {
    const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
    let body: Partial<ClassifyInput> = {};
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.message_id || !body.from) {
      return Response.json(
        { error: "message_id and from are required" },
        { status: 400 }
      );
    }
    try {
      const outcome = await classifyEmail({
        account_id: body.account_id ?? null,
        message_id: body.message_id,
        thread_id: body.thread_id ?? null,
        from: body.from,
        subject: body.subject ?? "",
        snippet: body.snippet ?? "",
        date: body.date ?? "",
      });
      if (!outcome) {
        return Response.json(
          { error: "No attention boards yet. Create one first." },
          { status: 409 }
        );
      }
      return Response.json(outcome);
    } catch (e) {
      return fail(e instanceof Error ? e : "Request failed");
    }
  };
}
