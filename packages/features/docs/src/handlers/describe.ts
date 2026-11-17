import { descriptionModule } from "@markbase/protocol/endpoint-gen";
import { definedEndpoints } from "./index";

// The text of logic/endpoints.generated.ts: every defined endpoint's
// description, as plain data, in the order the endpoints are defined.
// scripts/gen-endpoints.ts writes it; a test compares it with what is committed.

const HEADER = `// GENERATED from the endpoints defined in src/handlers — do not edit.
//
// An endpoint is written once, beside the code that answers it:
// \`endpoint({ id, method, path, capability, … }, async (req, params, auth) => …)\`.
// This is the description half of each, as plain data, for everything that
// must not import server code: the CLI, the MCP server, the skill, the browser.
// Change the definition, then run:
//   npm run gen:endpoints
`;

export function endpointsModule(): string {
  return descriptionModule(
    definedEndpoints().map((e) => e.def),
    {
      header: HEADER,
      typeImport: 'import type { DocEndpoint } from "./endpoints";',
      typeName: "DocEndpoint",
      exportName: "GENERATED_DOC_ENDPOINTS",
    }
  );
}
