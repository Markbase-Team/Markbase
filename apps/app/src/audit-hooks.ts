import { auditBin, hookApprovals, installAuditHooks, withToolPath, type AuditHookOptions, type AuditHookResult } from "@markbase/local";

// The audit hooks at launch. An agent that edits a mounted vault's files
// directly (Claude Code, Codex, Cursor) looks, to the sync, exactly like the
// person typing; its read-audit and write-audit hooks are the only thing that
// tells the two apart. The CLI adds them with `markbase mcp install`; a machine
// that only has the app would otherwise never get them. So the app runs the
// same installer (@markbase/local) for the agents it finds on this machine.
//
// Idempotent and quiet: a launch that changes nothing logs nothing. A config
// file that is read-only or cannot be parsed is left exactly as it was, and
// that is logged. MARKBASE_AUDIT_HOOKS=off turns the whole step off, the way
// MARKBASE_TICKETS gates the ticket worker.

export const AUDIT_HOOKS_ENV = "MARKBASE_AUDIT_HOOKS";

/** Off when asked for by name; on otherwise. */
export function auditHooksOff(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[AUDIT_HOOKS_ENV] === "off";
}

export interface EnsureAuditHooksDeps {
  /** One line to the vault log. */
  log: (message: string) => void;
  /**
   * Whether this machine has a key. Hooks on a signed-out machine would run
   * `markbase` on every tool call for vaults that cannot exist yet.
   */
  signedIn: boolean;
  env?: NodeJS.ProcessEnv;
  /** The installer; the real one unless a test says otherwise. */
  install?: (opts: AuditHookOptions) => AuditHookResult[];
}

/** Install the hooks for the agents on this machine, logging what changed. */
export function ensureAuditHooks(deps: EnsureAuditHooksDeps): AuditHookResult[] {
  const env = deps.env ?? process.env;
  if (auditHooksOff(env)) {
    deps.log(`audit hooks: off (${AUDIT_HOOKS_ENV}=off) — an agent's direct file edits are credited to you`);
    return [];
  }
  if (!deps.signedIn) return [];
  const install = deps.install ?? installAuditHooks;
  let results: AuditHookResult[];
  try {
    // The app was not started from a shell, so `markbase` is looked up on a
    // PATH that has the usual install locations; the hook command itself runs
    // in the agent's own shell, which has the person's PATH.
    results = install({ bin: deps.install ? undefined : auditBin(withToolPath(env)), env });
  } catch (e) {
    deps.log(`couldn't add the audit hooks: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  for (const r of results) {
    if (r.status === "installed") {
      deps.log(`audit hooks added for ${r.name} (${r.path}): its edits in a vault are now attributed to it`);
    } else if (r.status === "skipped" || r.status === "failed") {
      deps.log(`audit hooks not added for ${r.name}: ${r.detail}`);
    }
  }
  // Only for hooks added this launch: the reminder on every launch would bury
  // the log, and the CLI's installers repeat it for hooks already in place.
  for (const note of hookApprovals(results.filter((r) => r.status === "installed"))) deps.log(note);
  return results;
}
