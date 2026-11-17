import { routeFiles, type GeneratedFile } from "@markbase/protocol/endpoint-gen";
import { definedEndpoints } from "./index";

// The agents feature's route files, worked out from its endpoint definitions.
// scripts/gen-endpoints.ts writes them; a test compares them with what is
// committed. They live under src/app/api/v1, where the feature's manifest
// (markbase.json) contributes them to the web app.

const HEADER = `// GENERATED from the endpoints defined in packages/features/agents/src/handlers
// — do not edit.
//
// An endpoint is written once, with its handler: agents.define({ id, method, path, … }, access, run).
// Change it there, then run: npm run gen:endpoints (see docs/adding-an-endpoint.md)
`;

export function agentsRouteFiles(): GeneratedFile[] {
  return routeFiles(
    definedEndpoints().map((e) => e.def),
    {
      header: HEADER,
      routeName: "agentsRoute",
      // From src/app/api/v1/<…>/route.ts back up to src/handlers.
      routeImport: (file) =>
        `import { agentsRoute } from "${"../".repeat(file.split("/").length - 1 + 3)}handlers";`,
    }
  );
}
