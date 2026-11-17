// Generate src/logic/endpoints.generated.ts — the plain description of every
// documents endpoint — from the endpoints as they are defined beside their
// handlers (src/handlers, `endpoint(def, run)`).
//
//   npx tsx packages/features/docs/scripts/gen-endpoints.ts           write it
//   npx tsx packages/features/docs/scripts/gen-endpoints.ts --check   fail if stale
//
// The definitions are server code; the CLI, the MCP server, the skill and the
// browser must read the descriptions without importing them. This file is that
// copy. It is committed, and test/endpoints-generated.test.ts runs --check's
// comparison, so it cannot fall behind unnoticed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { endpointsModule } from "../src/handlers/describe";

const target = join(dirname(fileURLToPath(import.meta.url)), "../src/logic/endpoints.generated.ts");
const out = endpointsModule();

if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== out) {
    console.error(
      "src/logic/endpoints.generated.ts is out of date with the endpoints defined in src/handlers.\n" +
        "Run: npx tsx packages/features/docs/scripts/gen-endpoints.ts  — then commit."
    );
    process.exit(1);
  }
  console.log("endpoint descriptions are up to date");
} else {
  writeFileSync(target, out);
  console.log("generated src/logic/endpoints.generated.ts");
}
