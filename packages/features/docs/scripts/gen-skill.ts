// Generate skills/markbase/SKILL.md from the template + the endpoint registry.
// Run after changing the template, the registry, or the CLI version:
//   npx tsx packages/features/docs/scripts/gen-skill.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AGENT_ENDPOINTS } from "../src/logic/endpoints";
import { renderEndpointsDoc } from "../src/logic/skill-doc";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../../..");
const target = join(root, "skills/markbase/SKILL.md");

const version = JSON.parse(
  readFileSync(join(root, "apps/markbase/package.json"), "utf8")
).version as string;
const template = readFileSync(
  join(root, "skills/markbase/SKILL.template.md"),
  "utf8"
);

const out = template
  .replace("{{ENDPOINTS}}", renderEndpointsDoc())
  .replace(/^version:\s*.*$/m, `version: ${version}`);

// --check: fail (don't write) if the committed skill is stale — for prepublish.
if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== out) {
    console.error(
      "skills/markbase/SKILL.md is out of date with the template/registry.\n" +
        "Run: npx tsx packages/docs/scripts/gen-skill.ts  — then commit."
    );
    process.exit(1);
  }
  console.log("skill is up to date");
} else {
  writeFileSync(target, out);
  console.log(
    `generated skills/markbase/SKILL.md · version ${version} · ${AGENT_ENDPOINTS.length} endpoints`
  );
}
