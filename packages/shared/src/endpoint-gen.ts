import type { EndpointDef } from "./endpoint";

// What is generated from a feature's endpoint definitions, as text. Writing it
// to disk (and checking it is current) is the caller's: this module is plain
// string building, so the browser-safe half of the codebase can hold it.

export interface GeneratedFile {
  /** Relative to wherever the caller writes, e.g. `docs/[id]/tabs/[tabId]/route.ts`. */
  file: string;
  source: string;
}

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** `/docs/:id/tabs/:tabId` as the directory Next serves it from. */
function routeDir(path: string): string {
  return path.replace(/^\//, "").replace(/:(\w+)/g, "[$1]");
}

/**
 * The route files for a set of endpoints: one per path, one export per method,
 * each a single line naming the endpoint it serves.
 *
 * `routeImport` is the import that brings `routeName` into scope — the
 * function that turns an endpoint id into a route handler (an endpoint set's
 * `route`). It is given the route file's own path, because a feature's route
 * files import its handlers by a relative path that depends on their depth.
 */
export function routeFiles(
  defs: readonly EndpointDef[],
  opts: { header: string; routeName: string; routeImport: (file: string) => string; runtime?: string }
): GeneratedFile[] {
  const byPath = new Map<string, EndpointDef[]>();
  for (const e of defs) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
  return [...byPath.entries()]
    .map(([path, group]) => {
      const file = `${routeDir(path)}/route.ts`;
      const lines = [...group]
        .sort((a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method))
        .map((e) => `export const ${e.method} = ${opts.routeName}("${e.id}");`);
      const runtime = opts.runtime ? `\nexport const runtime = "${opts.runtime}";\n` : "";
      return {
        file,
        source: `${opts.header}${opts.routeImport(file)}\n${runtime}\n${lines.join("\n")}\n`,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * A module holding endpoint descriptions as plain data — the copy that code
 * which must not import a handler (the CLI, the MCP server, the browser) reads.
 */
export function descriptionModule(
  defs: readonly EndpointDef[],
  opts: { header: string; typeImport: string; typeName: string; exportName: string }
): string {
  return (
    `${opts.header}${opts.typeImport}\n\n` +
    `export const ${opts.exportName}: readonly ${opts.typeName}[] = ${JSON.stringify(defs, null, 2)};\n`
  );
}
