// Generate packages/core/protocol/src/docs/endpoints.generated.ts — the plain description of every
// documents endpoint — from the endpoints as they are defined beside their
// handlers (src/handlers, `endpoint(def, run)`).
//
//   npm run gen:endpoints                                             write everything
//   npx tsx packages/features/docs/scripts/gen-endpoints.ts --check   fail if stale
//
// The definitions are server code; the CLI, the MCP server, the skill and the
// browser must read the descriptions without importing them. This file is that
// copy. It is committed, and test/endpoints-generated.test.ts makes the same
// comparison --check does, so it cannot fall behind unnoticed.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { syncGeneratedFiles } from "@markbase/server/generated-files";
import { endpointsModule } from "../src/handlers/describe";

const ok = syncGeneratedFiles({
  root: join(dirname(fileURLToPath(import.meta.url)), "../../../core/protocol/src/docs"),
  files: [{ file: "endpoints.generated.ts", source: endpointsModule() }],
  check: process.argv.includes("--check"),
  what: "documents endpoint descriptions",
  fix: "npm run gen:endpoints",
});
if (process.argv.includes("--check") && !ok) process.exit(1);
