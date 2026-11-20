import { HOOK_AGENTS, hookApprovals, installAuditHooks, type AuditHookResult, type HookAgent } from "@markbase/node";

// `markbase audit install` — add the read-audit and write-audit hooks to the
// agents on this machine, so what they read and write in a vault is on record
// and a document's history can say an agent wrote a version.
//
// The hooks normally arrive without this command: `markbase mcp install` adds
// them to every agent it connects, and the desktop app adds them at launch.
// This is the by-hand way, for a machine that has neither, or an agent
// installed later. The installer itself lives in @markbase/node so all three
// write the same hooks.

// The merge functions, where the tests have always found them.
export { withCursorHooks, withToolHooks } from "@markbase/node";

const FLAGS: { flag: string; target: HookAgent }[] = [
  { flag: "--claude-code", target: "claude-code" },
  { flag: "--codex", target: "codex" },
  { flag: "--cursor", target: "cursor" },
];

const HELP = `markbase audit install — add the read-audit and write-audit hooks to your agents.

  markbase audit install                 every agent found on this machine
  markbase audit install --claude-code   only the ones named
                         --codex
                         --cursor

\`markbase mcp install\` and the desktop app add these hooks on their own; this
is for setting them up by hand.

Then:  markbase read-audit report   and   markbase write-audit report
`;

/**
 * One line per agent, the way every installer in this CLI reports, then what
 * an agent still needs from the person before its hooks run (Codex's approval).
 */
export function printHookResults(results: AuditHookResult[]): void {
  for (const r of results) {
    const name = r.name.padEnd(12);
    if (r.status === "installed") console.log(`  ✓ ${name} hooks → ${r.path}`);
    else if (r.status === "unchanged") console.log(`  • ${name} hooks already set up (${r.path})`);
    else if (r.status === "skipped") console.log(`  • ${name} hooks skipped (${r.detail})`);
    else console.log(`  ✗ ${name} hooks: ${r.detail}`);
  }
  for (const note of hookApprovals(results)) console.log(`\n⚠ ${note}`);
}

export async function runAudit(argv: string[]): Promise<void> {
  if (argv[0] !== "install") {
    console.log(HELP);
    if (argv[0] !== undefined && argv[0] !== "help" && argv[0] !== "--help") process.exitCode = 1;
    return;
  }
  const named = FLAGS.filter((f) => argv.includes(f.flag)).map((f) => f.target);
  const results = installAuditHooks(named.length > 0 ? { targets: named } : {});
  if (results.length === 0) {
    const folders = HOOK_AGENTS.map((a) => `~/.${a.target === "claude-code" ? "claude" : a.target}`);
    console.log(`No agent found on this machine (looked for ${folders.join(", ")}).`);
    return;
  }
  printHookResults(results);
  if (results.some((r) => r.status === "failed")) process.exitCode = 1;
  if (results.some((r) => r.status === "installed")) {
    console.log("\nRestart the agent so it picks the hooks up.");
  }
}
