import type { Authorize } from "@markbase/protocol/caller";
import {
  createDiary,
  deleteDiary,
  getDiary,
  listDiaries,
  updateDiary,
} from "../server";

// Route-handler factories for the diary API. The host app injects how it
// resolves the caller, so the package stays framework-agnostic and each handler
// returns a standard Web `Response`.
//
// Every diary query is scoped to an owner, and the shared contract supplies
// exactly that: `ownerId`, resolved the same way whether the caller arrived
// with a browser session or a bearer token. The handler never learns which.

export type { Authorize };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const badRequest = (error: string): Response =>
  Response.json({ error }, { status: 400 });

/** Parse a JSON body, or null when it is not JSON. */
async function readBody(
  req: Request
): Promise<{ entry_date?: string; title?: string; content?: string } | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function diariesHandler(authorize: Authorize) {
  return {
    // GET — all diary entries, sorted by date (newest first).
    GET: async (req: Request): Promise<Response> => {
      const caller = await authorize(req, "read");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      return Response.json({ diaries: await listDiaries(caller.ownerId) });
    },

    // POST { entry_date?, title?, content? } — start a new entry. entry_date
    // defaults to today, which the client sends as its own local date.
    POST: async (req: Request): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }

      const body = await readBody(req);
      if (!body) return badRequest("Invalid JSON");

      const entry_date =
        typeof body.entry_date === "string" ? body.entry_date.trim() : "";
      if (entry_date && !DATE_RE.test(entry_date)) {
        return badRequest("entry_date must be YYYY-MM-DD");
      }

      const diary = await createDiary(
        {
          entry_date: entry_date || undefined,
          title: typeof body.title === "string" ? body.title : "",
          content: typeof body.content === "string" ? body.content : "",
        },
        caller.ownerId
      );
      return Response.json({ diary }, { status: 201 });
    },
  };
}

export function diaryHandler(authorize: Authorize) {
  return {
    // PATCH — edit an entry's date, title, or markdown.
    PATCH: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      if (!(await getDiary(id, caller.ownerId))) {
        return Response.json({ error: "Diary not found" }, { status: 404 });
      }

      const body = await readBody(req);
      if (!body) return badRequest("Invalid JSON");

      const patch: { entry_date?: string; title?: string; content?: string } =
        {};
      if (typeof body.entry_date === "string") {
        if (!DATE_RE.test(body.entry_date.trim())) {
          return badRequest("entry_date must be YYYY-MM-DD");
        }
        patch.entry_date = body.entry_date.trim();
      }
      if (typeof body.title === "string") patch.title = body.title;
      if (typeof body.content === "string") patch.content = body.content;

      return Response.json({ diary: await updateDiary(id, patch, caller.ownerId) });
    },

    // DELETE — remove an entry.
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const caller = await authorize(req, "write");
      if (!caller.ok) {
        return Response.json({ error: caller.error }, { status: caller.status });
      }
      await deleteDiary(id, caller.ownerId);
      return Response.json({ ok: true });
    },
  };
}
