import {
  createProject,
  getProject,
  listProjects,
  updateProject,
} from "@markbase/protocol/tickets";
import {
  getRemoteOrigin,
  listBranches,
  normalizeRemote,
  validateLocalRepoPath,
} from "@markbase/node/repos";
import { owner, type HandlerHost } from "./host";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function projectsHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET — list all projects with repo info.
    GET: async (req: Request): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;
      return json({ projects: await listProjects(a.ownerId) });
    },

    // POST — create a project. Same fields as editing it: a name, slug, the
    // local repo path the worker runs in (a repo or a worktree — pick a
    // detected one or type a path), and an optional GitHub link. If the link is
    // omitted, it's read from the local repo's origin remote.
    POST: async (req: Request): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;

      let body: {
        slug?: string;
        name?: string;
        local_path?: string;
        github_repo?: string;
        owners?: string[];
      } = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const { slug, name, local_path, github_repo, owners } = body;

      if (owners !== undefined && !Array.isArray(owners)) {
        return json({ error: "owners must be a list of names" }, 400);
      }
      if (typeof slug !== "string" || !SLUG_RE.test(slug.trim())) {
        return json(
          { error: "slug is required (lowercase letters, numbers, hyphens)" },
          400
        );
      }
      if (typeof name !== "string" || !name.trim()) {
        return json({ error: "name is required" }, 400);
      }
      if (typeof local_path !== "string" || !local_path.trim()) {
        return json(
          { error: "A local repo path (repo or worktree) is required" },
          400
        );
      }

      const cleanSlug = slug.trim();
      if (await getProject(cleanSlug, a.ownerId)) {
        return json({ error: `Project "${cleanSlug}" already exists` }, 409);
      }

      const cleanPath = local_path.trim();
      const v = validateLocalRepoPath(cleanPath);
      if (!v.ok) return json({ error: v.error }, 400);

      // GitHub link: use what was typed (normalized when it looks like a
      // repo/URL), else fall back to the local repo's origin remote.
      const typedGithub =
        typeof github_repo === "string" ? github_repo.trim() : "";
      const link = typedGithub
        ? (normalizeRemote(typedGithub) ?? typedGithub)
        : await getRemoteOrigin(cleanPath);

      const project = await createProject({
        slug: cleanSlug,
        name: name.trim(),
        local_path: cleanPath,
        github_repo: link,
        owners,
        owner_id: a.ownerId,
      });

      return json({ project }, 201);
    },
  };
}

export function projectHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET — one of the caller's projects. The worker reads the local repo path
    // and the name of the project a ticket belongs to from here, rather than
    // from the table.
    GET: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;
      const project = await getProject(slug, a.ownerId);
      if (!project) return json({ error: "Project not found" }, 404);
      return json({ project });
    },

    // PATCH — edit a project after creation: rename it, change its slug, or fix
    // the repo link / local path by hand.
    PATCH: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;

      const existing = await getProject(slug, a.ownerId);
      if (!existing) return json({ error: "Project not found" }, 404);

      let body: {
        slug?: string;
        name?: string;
        github_repo?: string | null;
        local_path?: string | null;
        owners?: string[];
      } = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const patch: {
        slug?: string;
        name?: string;
        github_repo?: string | null;
        local_path?: string | null;
        owners?: string[];
      } = {};

      if (typeof body.name === "string") {
        if (!body.name.trim()) return json({ error: "name cannot be empty" }, 400);
        patch.name = body.name.trim();
      }

      // Rename: validate format and ensure the new slug is free (the tickets FK
      // is ON UPDATE CASCADE, so existing tickets follow the rename).
      if (typeof body.slug === "string" && body.slug.trim() !== slug) {
        const next = body.slug.trim();
        if (!SLUG_RE.test(next)) {
          return json(
            { error: "slug must be lowercase letters, numbers, hyphens" },
            400
          );
        }
        if (await getProject(next, a.ownerId)) {
          return json({ error: `Project "${next}" already exists` }, 409);
        }
        patch.slug = next;
      }

      // Repo link is edited by hand: store a normalized owner/repo or github URL
      // when it looks like one, otherwise keep what was typed. Empty clears it.
      if (typeof body.github_repo === "string") {
        const raw = body.github_repo.trim();
        patch.github_repo = raw ? (normalizeRemote(raw) ?? raw) : null;
      } else if (body.github_repo === null) {
        patch.github_repo = null;
      }

      // Local path must point at a real git repo when set; empty clears it.
      // Only re-validate when it actually changed — a plain rename leaves it
      // untouched, and re-checking would needlessly fail (e.g. the path is on
      // the local worker's disk, not on this server). validateLocalRepoPath
      // also skips the filesystem check on a host that can't see it (Vercel).
      if (typeof body.local_path === "string") {
        const raw = body.local_path.trim();
        if (raw) {
          if (raw !== existing.local_path) {
            const v = validateLocalRepoPath(raw);
            if (!v.ok) return json({ error: v.error }, 400);
          }
          patch.local_path = raw;
        } else {
          patch.local_path = null;
        }
      } else if (body.local_path === null) {
        patch.local_path = null;
      }

      // Owner names: an admin-managed list, normalized (trim/dedup) in
      // updateProject.
      if (body.owners !== undefined) {
        if (!Array.isArray(body.owners)) {
          return json({ error: "owners must be a list of names" }, 400);
        }
        patch.owners = body.owners;
      }

      return json({ project: await updateProject(slug, patch, a.ownerId) });
    },
  };
}

export function projectBranchesHandler(host: HandlerHost) {
  const { json } = host;
  // GET — list git branches of the project's local repo so a new ticket can
  // pick which branch to base work on.
  return async (req: Request, slug: string): Promise<Response> => {
    const a = await owner(req, "read", host);
    if ("error" in a) return a.error;

    const project = await getProject(slug, a.ownerId);
    if (!project) return json({ error: "Project not found" }, 404);
    if (!project.local_path) {
      return json({ branches: [], default: null, current: null });
    }
    return json(await listBranches(project.local_path));
  };
}
