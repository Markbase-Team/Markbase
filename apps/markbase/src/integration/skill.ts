import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// Single source of truth: the very same skills/markbase/SKILL.md that
// `npx skills add` and the Claude Code plugin use. It's inlined into the CLI at
// build time (tsup .md text loader), so `markbase skill install` writes a
// byte-identical file — there is no second copy of the content to drift.
import SKILL_MD from "../../../../skills/markbase/SKILL.md";

export async function runSkillInstall(argv: string[]): Promise<void> {
  const global = argv.includes("--global") || argv.includes("-g");
  const root = global ? homedir() : process.cwd();
  const dir = join(root, ".claude", "skills", "markbase");
  const file = join(dir, "SKILL.md");

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, SKILL_MD, "utf8");

  console.log(`Installed the markbase skill → ${file}\n`);
  console.log("Next steps:");
  console.log("  1. Set your key:   export MARKBASE_API_KEY=jsk_…");
  console.log("     (create one in the dashboard → API keys)");
  console.log(
    "  2. Restart your agent (Claude Code, etc.) so it picks up the new skill."
  );
  if (!global) {
    console.log(
      "Installed for this project. Use --global to install it for all projects (~/.claude/skills)."
    );
  }
}
