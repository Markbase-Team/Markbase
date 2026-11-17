import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncGeneratedFiles } from "@markbase/node/generated-files";
import { GENERATED_API_DIRS, generatedApiRoutes } from "./api-routes";

// Writes the documents API's route files from its endpoint definitions.
//
//   npm run gen:endpoints                        write everything generated from endpoints
//   npm run gen:api -w @markbase/web -- --check  fail if the route files are out of date
//
// The files are committed, so a checkout runs without generating anything; a
// test (test/api-routes-generated.test.ts) makes the same comparison as --check.

const ok = syncGeneratedFiles({
  root: join(dirname(fileURLToPath(import.meta.url)), "../src/app/api/v1"),
  files: generatedApiRoutes(),
  owned: { dirs: GENERATED_API_DIRS, name: "route.ts" },
  check: process.argv.includes("--check"),
  what: "documents api routes",
  fix: "npm run gen:endpoints",
});
if (process.argv.includes("--check") && !ok) process.exit(1);
