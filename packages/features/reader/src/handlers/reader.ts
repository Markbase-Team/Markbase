import { chatJson, type ContentPart } from "@markbase/llm";
import {
  addReaderMessage,
  createReaderDocument,
  createReaderHighlight,
  createReaderSelection,
  deleteReaderDocument,
  deleteReaderHighlight,
  deleteReaderMessage,
  deleteReaderSelection,
  getReaderDocument,
  listReaderDocuments,
  listReaderHighlights,
  listReaderSelections,
  setReaderDocumentLastPage,
  updateReaderSelection,
  type HighlightRect,
} from "../server";

// Route-handler factories for the reader. The host app injects its own auth
// check, so the package stays framework-agnostic and each handler returns a
// standard Web `Response` — the same body can be served by a Next route, an
// Electron IPC bridge, or any plain Node server.

import type { Authorize } from "@markbase/protocol/caller";

export type { Authorize };

/**
 * Every handler takes the request first, even when it does not read a body.
 *
 * That is what lets one host serve both credentials: the request carries the
 * bearer token, and the host reads its own session from ambient state. A
 * uniform first parameter also means the Next adapters are all the same shape.
 */

const badRequest = (error: string): Response =>
  Response.json({ error }, { status: 400 });

const notFound = (): Response =>
  Response.json({ error: "Not found" }, { status: 404 });

async function readBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

/** A string that is a plausible http(s) URL, else "". */
const httpUrl = (v: unknown): string =>
  typeof v === "string" && /^https?:\/\//.test(v) ? v : "";

const trimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function readerDocumentsHandler(authorize: Authorize) {
  return {
    // GET — saved PDFs, newest first.
    GET: async (req: Request): Promise<Response> => {
      const caller = await authorize(req, "read");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      return Response.json({ documents: await listReaderDocuments() });
    },

    // POST — record an uploaded PDF.
    POST: async (req: Request): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      const body = await readBody<{ name?: string; path?: string; url?: string }>(
        req
      );
      if (!body) return badRequest("Invalid JSON");
      const name = trimmed(body.name);
      const path = typeof body.path === "string" ? body.path : "";
      const url = httpUrl(body.url);
      if (!name || !path || !url) {
        return badRequest("name, path and url are required");
      }
      return Response.json(
        { document: await createReaderDocument({ name, path, url }) },
        { status: 201 }
      );
    },
  };
}

export function readerDocumentHandler(authorize: Authorize) {
  return {
    // GET — the document plus its selections, each with its Q&A thread
    // (everything needed to restore the reader view).
    GET: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "read");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      const document = await getReaderDocument(id);
      if (!document) return notFound();
      const [selections, highlights] = await Promise.all([
        listReaderSelections(id),
        listReaderHighlights(id),
      ]);
      return Response.json({ document, selections, highlights });
    },

    // PATCH — save the last-read page.
    PATCH: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      const body = await readBody<{ last_page?: number }>(req);
      if (!body) return badRequest("Invalid JSON");
      if (typeof body.last_page !== "number" || body.last_page < 1) {
        return badRequest("last_page is required");
      }
      await setReaderDocumentLastPage(id, Math.floor(body.last_page));
      return Response.json({ ok: true });
    },

    // DELETE — drop the document (selections and messages cascade). The stored
    // PDF object is left in the bucket.
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      await deleteReaderDocument(id);
      return Response.json({ ok: true });
    },
  };
}

export function readerHighlightsHandler(authorize: Authorize) {
  return {
    // POST — save a highlight (page-normalized rects).
    POST: async (req: Request): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      const body = await readBody<{
        document_id?: string;
        page?: number;
        rects?: HighlightRect[];
        color?: string;
        text?: string;
      }>(req);
      if (!body) return badRequest("Invalid JSON");
      const document_id =
        typeof body.document_id === "string" ? body.document_id : "";
      const rects = Array.isArray(body.rects)
        ? body.rects.filter(
            (r): r is HighlightRect =>
              !!r &&
              typeof r.x === "number" &&
              typeof r.y === "number" &&
              typeof r.w === "number" &&
              typeof r.h === "number"
          )
        : [];
      if (!document_id || rects.length === 0) {
        return badRequest("document_id and rects are required");
      }
      const highlight = await createReaderHighlight({
        document_id,
        page: typeof body.page === "number" ? body.page : 1,
        rects,
        color: typeof body.color === "string" ? body.color : undefined,
        text: typeof body.text === "string" ? body.text.trim() : undefined,
      });
      return Response.json({ highlight }, { status: 201 });
    },
  };
}

export function readerHighlightHandler(authorize: Authorize) {
  return {
    // DELETE — remove a highlight.
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      await deleteReaderHighlight(id);
      return Response.json({ ok: true });
    },
  };
}

export function readerSelectionsHandler(authorize: Authorize) {
  return {
    // POST — save a selected passage.
    POST: async (req: Request): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      const body = await readBody<{
        document_id?: string;
        page?: number;
        text?: string;
        image_url?: string;
        position?: number;
      }>(req);
      if (!body) return badRequest("Invalid JSON");
      const document_id =
        typeof body.document_id === "string" ? body.document_id : "";
      const text = trimmed(body.text);
      const image_url = httpUrl(body.image_url) || null;
      if (!document_id || (!text && !image_url)) {
        return badRequest("document_id and text or image_url are required");
      }
      const selection = await createReaderSelection({
        document_id,
        text,
        image_url,
        page: typeof body.page === "number" ? body.page : 1,
        position: typeof body.position === "number" ? body.position : 0,
      });
      return Response.json({ selection }, { status: 201 });
    },
  };
}

export function readerSelectionHandler(authorize: Authorize) {
  return {
    // PATCH — edit the quoted text.
    PATCH: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      const body = await readBody<{ text?: string; title?: string }>(req);
      if (!body) return badRequest("Invalid JSON");
      // text can't be blanked; title may be cleared (falls back in the UI).
      const text = trimmed(body.text) || undefined;
      const title = typeof body.title === "string" ? body.title.trim() : undefined;
      if (text === undefined && title === undefined) {
        return badRequest("text or title is required");
      }
      const selection = await updateReaderSelection(id, { text, title });
      return selection ? Response.json({ selection }) : notFound();
    },

    // DELETE — remove a selection (its messages cascade).
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      await deleteReaderSelection(id);
      return Response.json({ ok: true });
    },
  };
}

export function readerMessageHandler(authorize: Authorize) {
  return {
    // DELETE — remove one Q&A message.
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      await deleteReaderMessage(id);
      return Response.json({ ok: true });
    },
  };
}

const ASK_SYSTEM =
  "You are a knowledgeable reading assistant. The user selected a " +
  "passage or image region while reading and asked a question. The " +
  "selection is context for what they're looking at — NOT a limit on " +
  "what you may discuss. Answer the question directly and fully from " +
  "your own knowledge, even when the answer goes beyond the selection. " +
  "Never refuse or hedge that something is 'not in the passage / " +
  "outside the context.' Be concise and use GitHub-flavored markdown. " +
  'Respond as JSON: {"answer":"<markdown>"}.';

export function readerAskHandler(authorize: Authorize) {
  return {
    // POST { question, quote?, image_url?, selection_id? } — answer a question
    // about a selected passage or a cropped page region (vision). With a
    // selection_id, the Q&A is persisted under that selection.
    POST: async (req: Request): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }

      const body = await readBody<{
        quote?: string;
        question?: string;
        image_url?: string;
        selection_id?: string;
      }>(req);
      if (!body) return badRequest("Invalid JSON");

      const quote = trimmed(body.quote);
      const question = trimmed(body.question);
      const imageUrl = httpUrl(body.image_url);
      const selectionId =
        typeof body.selection_id === "string" ? body.selection_id : "";
      if (!quote && !imageUrl) return badRequest("quote or image_url is required");
      if (!question) return badRequest("question is required");

      // Image selections send the cropped region (vision); text selections send
      // the quoted passage.
      const userContent: string | ContentPart[] = imageUrl
        ? [
            {
              type: "text",
              text: `The user selected this region from a document page. Question: ${question}`,
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ]
        : `The user selected this passage from a document:\n"""\n${quote}\n"""\n\nQuestion: ${question}`;

      try {
        const result = await chatJson<{ answer?: string }>([
          { role: "system", content: ASK_SYSTEM },
          { role: "user", content: userContent },
        ]);
        const answer = result?.answer?.trim();
        if (!answer) {
          return Response.json(
            { error: "The model is unavailable right now" },
            { status: 503 }
          );
        }
        // Persist the Q&A under its selection when one is provided.
        let messageId: string | undefined;
        if (selectionId) {
          try {
            messageId = (
              await addReaderMessage({
                selection_id: selectionId,
                question,
                answer,
              })
            ).id;
          } catch {
            // Non-fatal: still return the answer even if persistence fails.
          }
        }
        return Response.json({ answer, messageId });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to ask";
        return Response.json({ error: message }, { status: 500 });
      }
    },
  };
}
