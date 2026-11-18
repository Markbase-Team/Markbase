import type { CallResult } from "./call";

// Which key the MCP server sends, and what it does when it has none that works.
//
// An agent starts this server; nobody is at a terminal to run `markbase login`.
// So the sign-in happens from the first tool call that needs it: the browser
// opens on the page `markbase login` uses, the person approves there, and the
// call goes through. A call that would otherwise wait too long comes back
// saying what is on the person's screen, and the next call picks up where the
// sign-in got to. Its own file so it can be tested without a server or a
// browser.

/** How long one tool call waits for the person before it answers "approve, then retry". */
const WAIT_MS = 45_000;

export interface McpAuthDeps {
  /** The key the agent's config named in MARKBASE_API_KEY, or "". */
  environmentKey: () => string;
  /** The key saved on this machine, or "". Read each time: a sign-in elsewhere changes it. */
  savedKey: () => string;
  /** Whether a browser can be put in front of someone here. */
  canSignIn: () => boolean;
  /**
   * Start a sign-in in the browser. `opened` is told the page's address as
   * soon as there is one. Resolves with the new key, already saved.
   */
  signIn: (opened: (url: string) => void) => Promise<string>;
  /** Overrides WAIT_MS; for tests. */
  waitMs?: number;
}

/** A call that could not be sent yet: what to tell the agent instead. */
export interface NeedsSignIn {
  needsSignIn: string;
}

export interface McpAuth {
  /** The key to try first, or "" when there is none. Never starts a sign-in. */
  key(): string;
  /**
   * Send a request with a key that works. Tries the keys this machine has,
   * and when the API refuses them all (or there are none) signs the person in
   * and sends it with the new one.
   */
  call(send: (key: string) => Promise<CallResult>): Promise<CallResult | NeedsSignIn>;
}

interface Attempt {
  url: Promise<string>;
  key: Promise<string>;
}

type Outcome = { key: string } | { failed: string } | { waiting: true };

export function mcpAuth(deps: McpAuthDeps): McpAuth {
  // Keys the API has answered 401 to while this server has been running. An
  // agent's config can hold a key that was since revoked; without this every
  // call would spend a request finding that out again.
  const refused = new Set<string>();
  let attempt: Attempt | null = null;

  const keys = (): string[] =>
    [deps.environmentKey(), deps.savedKey()].filter(
      (key, at, all) => key !== "" && !refused.has(key) && all.indexOf(key) === at
    );

  /** The sign-in in progress, or a new one. Calls arriving together share it. */
  const signingIn = (): Attempt => {
    if (attempt) return attempt;
    let opened: (url: string) => void = () => {};
    const url = new Promise<string>((resolve) => {
      opened = resolve;
    });
    const mine: Attempt = { url, key: deps.signIn(opened) };
    const done = (): void => {
      if (attempt === mine) attempt = null;
    };
    mine.key.then(done, done);
    attempt = mine;
    return mine;
  };

  const wait = async (mine: Attempt): Promise<Outcome> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<Outcome>((resolve) => {
      timer = setTimeout(() => resolve({ waiting: true }), deps.waitMs ?? WAIT_MS);
    });
    const finished = mine.key.then(
      (key): Outcome => ({ key }),
      (e): Outcome => ({ failed: e instanceof Error ? e.message : String(e) })
    );
    try {
      return await Promise.race([finished, waited]);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    key: () => keys()[0] ?? "",

    async call(send) {
      for (const key of keys()) {
        const res = await send(key);
        if (res.status !== 401) return res;
        refused.add(key);
      }

      if (!deps.canSignIn()) {
        return {
          needsSignIn:
            "Not signed in to Markbase, and this machine cannot open a browser to sign in. " +
            "Create a key in the Markbase dashboard under API keys and set MARKBASE_API_KEY " +
            "in this server's config.",
        };
      }

      const mine = signingIn();
      const outcome = await wait(mine);
      if ("key" in outcome) return send(outcome.key);
      if ("failed" in outcome) {
        return {
          needsSignIn:
            `Signing in to Markbase did not complete (${outcome.failed}). ` +
            "Run this again to try once more, or run `markbase login` in a terminal.",
        };
      }
      // Still open in the browser. The address is there by now; "" if not.
      const url = await Promise.race([mine.url, Promise.resolve("")]);
      return {
        needsSignIn:
          "Markbase needs the user to sign in before this can run. A browser window has opened" +
          (url ? ` at ${url}` : "") +
          ". Ask them to approve it there, then run this again.",
      };
    },
  };
}
