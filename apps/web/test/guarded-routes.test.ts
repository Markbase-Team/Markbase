import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Behind a guarded prefix, a route file is the URL and nothing else. The gate
// in src/proxy.ts authenticates, answers preflight and sets CORS before the
// request reaches the route — so a route that also does any of that has two
// gates, and two gates disagree eventually. This holds the line for the
// prefixes that have moved; the list grows by one entry per feature.

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The guarded prefixes whose route files this app still holds, as directories.
 *
 * Only docs' now: every other guarded feature's route files are generated
 * from its manifest, and the package modules behind them are held to the same
 * rule by the package boundary test's `next/*` check and by having no
 * `@/lib` to reach for.
 */
const GUARDED_DIRS = ["docs", "vaults", "assets"].map((d) =>
  join(appRoot, "src/app/api/v1", d)
);

/** What a route file behind the gate must not do for itself. */
const SELF_GATING = [
  /\bauthenticateAgent\b/,
  /\bresolveCaller\b/,
  /\bpreflight\b/,
  /\bCORS_HEADERS\b/,
  /\bOPTIONS\b/,
  /@\/lib\/docs-gate/,
  /@\/lib\/agent-auth/,
];

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(p);
    return e.name === "route.ts" ? [p] : [];
  });
}

describe("route files behind the gate", () => {
  const files = GUARDED_DIRS.flatMap(routeFiles);

  it("exist to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [f.slice(appRoot.length + 1)]))(
    "%s neither authenticates nor answers CORS itself",
    (rel) => {
      const source = readFileSync(join(appRoot, rel), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*)/.test(line))
        .join("\n");
      for (const pattern of SELF_GATING) {
        expect(source, String(pattern)).not.toMatch(pattern);
      }
    }
  );
});
