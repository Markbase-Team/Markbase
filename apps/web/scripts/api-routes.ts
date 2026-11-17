import { DOC_ENDPOINTS, type DocEndpoint } from "@markbase/docs/endpoints";

// The route files of the documents API, worked out from the endpoint registry.
//
// One file per path, one export per method, each a single line naming the
// endpoint it serves. Nothing else: who may call it is the registry's, what
// runs is the handler table's (@markbase/docs/handlers, endpoint-handlers.ts),
// and authentication is the gate's (src/proxy.ts).

/** The directories under src/app/api/v1 whose every route file is generated. */
export const GENERATED_API_DIRS = ["docs", "vaults", "assets"] as const;

export interface GeneratedRoute {
  /** Relative to src/app/api/v1, e.g. `docs/[id]/tabs/[tabId]/route.ts`. */
  file: string;
  source: string;
}

const METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const HEADER = `// GENERATED from the endpoint registry — do not edit.
//
// An endpoint is its entry in packages/features/docs/src/logic/endpoints.ts and
// its handler in packages/features/docs/src/handlers/endpoint-handlers.ts.
// Change those, then run: npm run gen:api -w @markbase/web
import { endpointRoute } from "@markbase/docs/handlers";

export const runtime = "nodejs";
`;

/** `/docs/:id/tabs/:tabId` as the directory Next serves it from. */
function routeDir(path: string): string {
  return path.replace(/^\//, "").replace(/:(\w+)/g, "[$1]");
}

export function generatedApiRoutes(endpoints: readonly DocEndpoint[] = DOC_ENDPOINTS): GeneratedRoute[] {
  const byPath = new Map<string, DocEndpoint[]>();
  for (const e of endpoints) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e]);
  return [...byPath.entries()]
    .map(([path, group]) => {
      const lines = [...group]
        .sort((a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method))
        .map((e) => `export const ${e.method} = endpointRoute("${e.id}");`);
      return { file: `${routeDir(path)}/route.ts`, source: `${HEADER}\n${lines.join("\n")}\n` };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}
