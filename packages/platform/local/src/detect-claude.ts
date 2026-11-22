import { spawnSync } from "node:child_process";

/**
 * Probe the local machine for Claude Code. Returns the version string
 * (e.g. "2.0.14 (Claude Code)") or null if the binary isn't there.
 *
 * `bin` is the binary to ask — a path, or a name for PATH to resolve. The
 * default is `claude` on PATH; a host that ships its own Claude asks that one,
 * since it is the one its tickets will actually run under.
 *
 * Runs on the user's machine only — from `markbase login` and from the worker's
 * sweep. Never from a request handler; the server can't see the user's PATH.
 */
export function detectClaudeVersion(bin = "claude"): string | null {
  try {
    const res = spawnSync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
    });
    if (res.error || res.status !== 0) return null;
    const out = (res.stdout ?? "").trim();
    return out ? out.slice(0, 100) : null;
  } catch {
    // A missing binary throws on some platforms rather than setting `error`.
    return null;
  }
}
