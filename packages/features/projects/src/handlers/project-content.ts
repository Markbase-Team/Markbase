import {
  createProjectDoc,
  deleteProjectDoc,
  listProjectDocs,
  updateProjectDoc,
} from "@markbase/protocol/project-docs";
import {
  createWorkLog,
  deleteWorkLog,
  listWorkLogs,
  updateWorkLog,
} from "@markbase/protocol/work-logs";
import { getProject } from "@markbase/protocol/tickets";
import { owner, type HandlerHost } from "./host";

// A project's own writing: its documentation and its work logs.

export function projectDocsHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET — the project's documentation.
    GET: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;
      return json({ docs: await listProjectDocs(slug, a.ownerId) });
    },

    // POST { title?, content? }
    POST: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;
      if (!(await getProject(slug, a.ownerId))) {
        return json({ error: "Project not found" }, 404);
      }

      let body: { title?: string; content?: string } = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const doc = await createProjectDoc({
        project: slug,
        title: typeof body.title === "string" ? body.title : "",
        content: typeof body.content === "string" ? body.content : "",
      });
      return json({ doc }, 201);
    },
  };
}

export function projectDocHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // PATCH — edit title/content.
    PATCH: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;

      let body: { title?: string; content?: string } = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const patch: { title?: string; content?: string } = {};
      if (typeof body.title === "string") patch.title = body.title;
      if (typeof body.content === "string") patch.content = body.content;

      const doc = await updateProjectDoc(id, patch, a.ownerId);
      return doc ? json({ doc }) : json({ error: "Not found" }, 404);
    },

    // DELETE — remove a doc.
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;
      await deleteProjectDoc(id, a.ownerId);
      return json({ ok: true });
    },
  };
}

export function workLogsHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET — the project's logs (newest first).
    GET: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;
      return json({ logs: await listWorkLogs(slug, a.ownerId) });
    },

    // POST { entry_date?, title?, content? } — entry_date is optional; omit
    // (or null) for an undated log.
    POST: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;
      if (!(await getProject(slug, a.ownerId))) {
        return json({ error: "Project not found" }, 404);
      }

      let body: { entry_date?: string | null; title?: string; content?: string } =
        {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const log = await createWorkLog({
        project: slug,
        entry_date: body.entry_date ?? null,
        title: typeof body.title === "string" ? body.title : "",
        content: typeof body.content === "string" ? body.content : "",
      });
      return json({ log }, 201);
    },
  };
}

export function workLogHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // PATCH — edit date/title/content. entry_date: a string dates it, null
    // makes it undated.
    PATCH: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;

      let body: { entry_date?: string | null; title?: string; content?: string } =
        {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const patch: {
        entry_date?: string | null;
        title?: string;
        content?: string;
      } = {};
      if (body.entry_date !== undefined) {
        patch.entry_date = body.entry_date === "" ? null : body.entry_date;
      }
      if (typeof body.title === "string") patch.title = body.title;
      if (typeof body.content === "string") patch.content = body.content;

      const log = await updateWorkLog(id, patch, a.ownerId);
      return log ? json({ log }) : json({ error: "Not found" }, 404);
    },

    // DELETE — remove a log.
    DELETE: async (req: Request, id: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;
      await deleteWorkLog(id, a.ownerId);
      return json({ ok: true });
    },
  };
}
