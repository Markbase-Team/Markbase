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
//   npx tsx packages/features/docs/scripts/gen-endpoints.ts
import type { DocEndpoint } from "./endpoints";

export const GENERATED_DOC_ENDPOINTS: readonly DocEndpoint[] = `;

export function endpointsModule(): string {
  const defs = definedEndpoints().map((e) => e.def);
  return `${HEADER}${JSON.stringify(defs, null, 2)};\n`;
}
