import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKER_ENDPOINTS } from "@markbase/docs/endpoints";

// Security lockdown stage 2: the ticket worker reaches the database only
// through these routes. The registry says what exists; this says each entry is
// served — the manifest contributes the route file to the web app, and the
// module behind it exports the method — so a declaration nobody wired up
// fails here rather than as a worker that 404s in production.
//
// This used to look for the route files in apps/web. They are generated there
// now, from the `contributes.app` list below, so the list is what is checked.

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(pkgRoot, "markbase.json"), "utf8")) as {
  contributes: { app: (string | { path: string })[] };
};
const contributed = new Set(
  manifest.contributes.app.map((e) => (typeof e === "string" ? e : e.path))
);

/** "/worker/jobs/:id/finish" → "api/v1/worker/jobs/[id]/finish/route" */
function routePath(path: string): string {
  const segments = path
    .split("/")
    .filter(Boolean)
    .map((s) => (s.startsWith(":") ? `[${s.slice(1)}]` : s));
  return ["api/v1", ...segments, "route"].join("/");
}

describe("every worker endpoint in the registry has its route", () => {
  it.each(WORKER_ENDPOINTS.map((e) => [`${e.method} ${e.path}`, e.method, routePath(e.path)]))(
    "%s is served by %s",
    (_label, method, rel) => {
      expect(contributed.has(rel), `${rel} in contributes.app`).toBe(true);
      const file = join(pkgRoot, "src/app", `${rel}.ts`);
      expect(existsSync(file), file).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source, `${rel} exports ${method}`).toMatch(
        new RegExp(`export (async function|const) (\\{[^}]*\\b)?${method}\\b`)
      );
    }
  );
});
