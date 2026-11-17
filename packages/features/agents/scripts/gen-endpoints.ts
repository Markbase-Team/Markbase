// Write the agents feature's route files from its endpoint definitions
// (src/handlers). `--check` fails instead when they are out of date.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { syncGeneratedFiles } from "@markbase/node/generated-files";
import { agentsRouteFiles } from "../src/handlers/routes";

const ok = syncGeneratedFiles({
  root: join(dirname(fileURLToPath(import.meta.url)), "../src/app/api/v1"),
  files: agentsRouteFiles(),
  owned: { dirs: ["."], name: "route.ts" },
  check: process.argv.includes("--check"),
  what: "agents api routes",
  fix: "npm run gen:endpoints",
});
if (process.argv.includes("--check") && !ok) process.exit(1);
