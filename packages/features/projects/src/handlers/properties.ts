import {
  createProjectProperty,
  deleteProjectProperty,
  getProject,
  getProjectProperty,
  listProjectProperties,
  updateProjectProperty,
} from "@markbase/protocol/tickets";
import { owner, type HandlerHost } from "./host";

/** Trim, drop blanks, and de-duplicate the allowed-values list for a property. */
function cleanOptions(options: string[] | undefined): string[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    if (typeof o !== "string") continue;
    const v = o.trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export function projectPropertiesHandler(host: HandlerHost) {
  const { json } = host;
  return {
    // GET — list a project's properties.
    GET: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "read", host);
      if ("error" in a) return a.error;
      if (!(await getProject(slug, a.ownerId))) {
        return json({ error: "Project not found" }, 404);
      }
      return json({ properties: await listProjectProperties(slug, a.ownerId) });
    },

    // POST — define a new property on a project. `options` is the optional
    // fixed set of allowed values.
    POST: async (req: Request, slug: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;
      if (!(await getProject(slug, a.ownerId))) {
        return json({ error: "Project not found" }, 404);
      }

      let body: { name?: string; options?: string[]; default_value?: string } = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      if (typeof body.name !== "string" || !body.name.trim()) {
        return json({ error: "name is required" }, 400);
      }

      const existing = await listProjectProperties(slug, a.ownerId);
      const name = body.name.trim();
      if (existing.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        return json({ error: `Property "${name}" already exists` }, 409);
      }

      const options = cleanOptions(body.options);
      // A default must be one of the allowed options (else it's cleared).
      const rawDefault =
        typeof body.default_value === "string" ? body.default_value.trim() : "";
      const default_value = options.includes(rawDefault) ? rawDefault : "";

      try {
        const property = await createProjectProperty({
          project: slug,
          name,
          options,
          default_value,
          // New properties append to the end of the list.
          position: existing.length,
        });
        return json({ property }, 201);
      } catch {
        return json({ error: "Failed to create property" }, 500);
      }
    },
  };
}

export function projectPropertyHandler(host: HandlerHost) {
  const { json } = host;

  /** Confirm the property exists and belongs to the project in the URL. */
  const ownedByProject = async (id: string, slug: string, ownerId: string) => {
    const property = await getProjectProperty(id, ownerId);
    if (!property || property.project !== slug) return undefined;
    return property;
  };

  return {
    // PATCH — rename a property or change its allowed values.
    PATCH: async (req: Request, slug: string, id: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;

      const existing = await ownedByProject(id, slug, a.ownerId);
      if (!existing) return json({ error: "Property not found" }, 404);

      let body: { name?: string; options?: string[]; default_value?: string } = {};
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const patch: { name?: string; options?: string[]; default_value?: string } =
        {};

      if (typeof body.name === "string") {
        const name = body.name.trim();
        if (!name) return json({ error: "name cannot be empty" }, 400);
        const siblings = await listProjectProperties(slug, a.ownerId);
        if (
          siblings.some(
            (p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase()
          )
        ) {
          return json({ error: `Property "${name}" already exists` }, 409);
        }
        patch.name = name;
      }

      if (body.options !== undefined) {
        patch.options = cleanOptions(body.options);
      }

      // A default must be one of the property's (possibly just-updated) options.
      if (body.default_value !== undefined) {
        const effectiveOptions = patch.options ?? existing.options;
        const raw =
          typeof body.default_value === "string" ? body.default_value.trim() : "";
        patch.default_value = effectiveOptions.includes(raw) ? raw : "";
      } else if (patch.options !== undefined) {
        // Options changed and the old default is no longer valid → clear it.
        if (
          existing.default_value &&
          !patch.options.includes(existing.default_value)
        ) {
          patch.default_value = "";
        }
      }

      return json({
        property: await updateProjectProperty(id, patch, a.ownerId),
      });
    },

    // DELETE — remove a property. Existing ticket values for it become orphaned
    // keys in the tickets JSONB and are simply ignored by the UI (which renders
    // only currently-defined properties).
    DELETE: async (req: Request, slug: string, id: string): Promise<Response> => {
      const a = await owner(req, "write", host);
      if ("error" in a) return a.error;
      if (!(await ownedByProject(id, slug, a.ownerId))) {
        return json({ error: "Property not found" }, 404);
      }
      await deleteProjectProperty(id, a.ownerId);
      return json({ ok: true });
    },
  };
}
