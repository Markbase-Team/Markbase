import { DOC_ENDPOINTS, type DocEndpoint } from "@markbase/shared/docs/endpoints";
import { routeFiles, type GeneratedFile } from "@markbase/shared/endpoint-gen";

// The route files of the documents API, worked out from the endpoint registry.
//
// One file per path, one export per method, each a single line naming the
// endpoint it serves. Nothing else: what the endpoint is, who may call it and
// what runs are all in its one definition (`endpoint(def, run)` in
// packages/features/docs/src/handlers), and authentication is the gate's
// (src/proxy.ts).

/** The directories under src/app/api/v1 whose every route file is generated. */
export const GENERATED_API_DIRS = ["docs", "vaults", "assets", "hook-events", "nudge"] as const;

export type GeneratedRoute = GeneratedFile;

const HEADER = `// GENERATED from the endpoints defined in packages/features/docs/src/handlers
// — do not edit.
//
// An endpoint is written once, with its handler: endpoint({ id, method, path, … }, run).
// Change it there, then run: npm run gen:endpoints (see docs/adding-an-endpoint.md)
`;

export function generatedApiRoutes(endpoints: readonly DocEndpoint[] = DOC_ENDPOINTS): GeneratedRoute[] {
  return routeFiles(endpoints, {
    header: HEADER,
    routeName: "endpointRoute",
    routeImport: () => 'import { endpointRoute } from "@markbase/docs/handlers";',
    runtime: "nodejs",
  });
}
