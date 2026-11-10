// Signing in to Claude, using the binary we ship.
//
// The bundled executable is full Claude Code, so it already knows how to log in
// — there is no auth protocol to reimplement here, only a subprocess to drive:
//
//   claude auth status --json     what we render
//   claude auth login --claudeai  the OAuth flow (or --console for API billing)
//   claude auth logout
//
// The login is a PASTE-CODE flow, which is why this can be a GUI at all. Spawned
// on a pipe it prints the authorize URL and then blocks on stdin:
//
//   Opening browser to sign in…
//   If the browser didn't open, visit: <url>
//   Paste code here if prompted >
//
// So: open the URL in the user's browser, take the code they paste back, write it
// to the child's stdin. No TTY, no local callback server, no pty.
//
// NOTE: credentials are NOT private to this app. The bundled binary reads and
// writes the same store as any installed Claude Code, so signing in here signs
// you in everywhere, and `claude auth logout` elsewhere signs you out here.

import { execFile } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { bundledClaudePath, bundledClaudeSearchPaths } from "./claude-bin";

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  /** "claude.ai" for a subscription, "console" for API billing. */
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgName?: string;
  /** "max", "pro", … — absent on API billing. */
  subscriptionType?: string;
  /** Set when we could not ask at all (no binary, spawn failed). */
  error?: string;
}

function missing(): string {
  return (
    "This build shipped without a Claude binary. Looked in:\n" +
    bundledClaudeSearchPaths().join("\n")
  );
}

/** Ask the bundled binary who is signed in. Never throws — the UI renders this. */
export async function claudeAuthStatus(): Promise<ClaudeAuthStatus> {
  const bin = bundledClaudePath();
  if (!bin) return { loggedIn: false, error: missing() };

  return new Promise((resolve) => {
    execFile(bin, ["auth", "status", "--json"], { timeout: 20_000 }, (err, stdout) => {
      // A non-zero exit still prints JSON when it simply means "not signed in",
      // so parse first and only treat unparseable output as a real failure.
      try {
        const parsed = JSON.parse(stdout) as ClaudeAuthStatus;
        resolve({ ...parsed, loggedIn: !!parsed.loggedIn });
      } catch {
        resolve({
          loggedIn: false,
          error: err ? err.message : `couldn't read auth status: ${stdout.slice(0, 200)}`,
        });
      }
    });
  });
}

export async function claudeLogout(): Promise<{ ok: boolean; error?: string }> {
  const bin = bundledClaudePath();
  if (!bin) return { ok: false, error: missing() };
  return new Promise((resolve) => {
    execFile(bin, ["auth", "logout"], { timeout: 30_000 }, (err) =>
      resolve(err ? { ok: false, error: err.message } : { ok: true })
    );
  });
}

/** Terminal escapes around the URL — it is printed as an OSC-8 hyperlink. */
const OSC8 = /\x1b\]8;;[^\x1b\x07]*(?:\x1b\\|\x07)/g;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Pull the authorize URL out of the CLI's output.
 *
 * It arrives as an OSC-8 hyperlink, so the URL appears TWICE and back-to-back —
 * once as the link target and once as the visible label, with no separator
 * between them. A plain `https://\S+` match therefore captures both glued
 * together and yields a URL that 404s. Strip the escape wrapper first, then cut
 * at any second occurrence as a belt-and-braces guard.
 */
export function extractAuthUrl(chunk: string): string | null {
  const clean = chunk.replace(OSC8, "").replace(ANSI, "");
  const m = /(https:\/\/[^\s"'<>]+)/.exec(clean);
  if (!m) return null;
  let url = m[1];
  const again = url.indexOf("https://", "https://".length);
  if (again > 0) url = url.slice(0, again);
  return url;
}

/** Does this output mean the CLI is now waiting for the pasted code? */
export function wantsCode(chunk: string): boolean {
  return /paste\s+code/i.test(chunk.replace(OSC8, "").replace(ANSI, ""));
}

export interface LoginHandle {
  /** Send the code the user pasted from the browser. */
  submitCode(code: string): void;
  cancel(): void;
}

export interface LoginCallbacks {
  /** The authorize URL, as soon as it is known — open it in a browser. */
  onUrl(url: string): void;
  /** The CLI is now waiting for a code. */
  onNeedsCode(): void;
  /** Raw progress text, for a log line in the UI. */
  onOutput(text: string): void;
  /** Finished: `ok` reflects the CLI's exit status. */
  onDone(result: { ok: boolean; error?: string }): void;
}

/**
 * Start a login. Returns immediately with a handle — the flow completes when the
 * user pastes their code and the child exits.
 *
 * `mode` picks what the account is billed as: "subscription" (the default, a
 * Claude plan) or "console" (Anthropic Console, metered API usage).
 */
export function startClaudeLogin(
  mode: "subscription" | "console",
  cb: LoginCallbacks
): LoginHandle {
  const bin = bundledClaudePath();
  if (!bin) {
    cb.onDone({ ok: false, error: missing() });
    return { submitCode: () => {}, cancel: () => {} };
  }

  let child: ChildProcess;
  try {
    child = spawn(bin, ["auth", "login", mode === "console" ? "--console" : "--claudeai"], {
      stdio: ["pipe", "pipe", "pipe"],
      // The CLI opens the browser itself; BROWSER is left alone so the user's
      // default handler wins. We also surface the URL, in case it cannot.
    });
  } catch (e) {
    cb.onDone({ ok: false, error: e instanceof Error ? e.message : String(e) });
    return { submitCode: () => {}, cancel: () => {} };
  }

  let sentUrl = false;
  let asked = false;
  let stderr = "";

  const read = (text: string): void => {
    cb.onOutput(text.replace(OSC8, "").replace(ANSI, ""));
    if (!sentUrl) {
      const url = extractAuthUrl(text);
      if (url) {
        sentUrl = true;
        cb.onUrl(url);
      }
    }
    if (!asked && wantsCode(text)) {
      asked = true;
      cb.onNeedsCode();
    }
  };

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (d: string) => read(d));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (d: string) => {
    stderr += d;
    read(d);
  });

  let settled = false;
  const done = (result: { ok: boolean; error?: string }): void => {
    if (settled) return;
    settled = true;
    cb.onDone(result);
  };

  child.on("error", (e) => done({ ok: false, error: e.message }));
  child.on("close", (code) =>
    done(
      code === 0
        ? { ok: true }
        : { ok: false, error: stderr.replace(OSC8, "").replace(ANSI, "").trim() || `sign-in exited with code ${code}` }
    )
  );

  return {
    submitCode(code: string): void {
      // The CLI reads one line from stdin. Trim first: a code pasted from the
      // browser usually arrives with surrounding whitespace or a newline, and
      // sending that through unmodified submits an empty second line.
      child.stdin?.write(`${code.trim()}\n`);
    },
    cancel(): void {
      child.kill("SIGTERM");
      done({ ok: false, error: "canceled" });
    },
  };
}
