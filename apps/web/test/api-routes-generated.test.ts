import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOC_ENDPOINTS, type DocEndpoint } from "@markbase/docs/endpoints";
import { GENERATED_API_DIRS, generatedApiRoutes } from "../scripts/api-routes";

// The documents API's route files are generated from the endpoint registry
// (scripts/gen-api-routes.ts) and committed. This is the comparison its
// --check runs: what is on disk is exactly what the registry generates — no
// file edited by hand, none missing, none left over. So a route under these
// directories exists only because a registry entry does.

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "../src/app/api/v1");

function routeFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return e.name === "route.ts" ? [p] : [];
  });
}

describe("generated API route files", () => {
  const wanted = generatedApiRoutes();

  it("covers every registry path under the generated directories, and only those", () => {
    for (const e of DOC_ENDPOINTS) {
      expect(GENERATED_API_DIRS.some((d) => e.path === `/${d}` || e.path.startsWith(`/${d}/`)), e.path).toBe(true);
    }
    expect(wanted.length).toBeGreaterThan(20);
  });

  it.each(wanted.map((r) => [r.file, r.source]))("%s is as generated", (file, source) => {
    const abs = join(apiRoot, file);
    expect(existsSync(abs), `${file} is missing — run: npm run gen:api -w @markbase/web`).toBe(true);
    expect(readFileSync(abs, "utf8"), `${file} was edited by hand or is stale — run: npm run gen:api -w @markbase/web`).toBe(source);
  });

  it("has no route file the registry did not generate", () => {
    const expected = new Set(wanted.map((r) => join(apiRoot, r.file)));
    const extra = GENERATED_API_DIRS.flatMap((d) => routeFiles(join(apiRoot, d))).filter((f) => !expected.has(f));
    expect(extra.map((f) => f.slice(apiRoot.length + 1))).toEqual([]);
  });

  it("writes one export per method, each naming its endpoint", () => {
    const endpoints: DocEndpoint[] = [
      { id: "docs_b", method: "DELETE", path: "/docs/:id/things/:thingId", capability: "owner", scope: "write", summary: "b" },
      { id: "docs_a", method: "GET", path: "/docs/:id/things/:thingId", capability: "viewer", scope: "read", summary: "a" },
    ];
    const [route] = generatedApiRoutes(endpoints);
    expect(route.file).toBe("docs/[id]/things/[thingId]/route.ts");
    expect(route.source.split("\n").filter((l) => l.startsWith("export const ") && l.includes("endpointRoute"))).toEqual([
      'export const GET = endpointRoute("docs_a");',
      'export const DELETE = endpointRoute("docs_b");',
    ]);
  });
});
