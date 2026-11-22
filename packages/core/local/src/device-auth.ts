// Authorizing a device in the browser (the flow `markbase login` has always used,
// now shared so the desktop app can sign in too — roadmap C4).
//
// The device opens a loopback server, sends the user to /cli-auth with a callback
// and a state, and waits. The page — where the user is already signed in — mints a
// key and redirects back to the loopback with it. No password ever touches this
// process, and the key is bound to whoever was signed in, which is the whole point:
// the identity comes from the browser session, not from a file someone left on the
// machine.
//
// `state` is the CSRF guard: anything can hit a loopback port, so a key arriving
// without the exact value we generated is refused rather than saved.

import { authorizeUrl } from "@markbase/protocol/device-auth-contract";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

const PAGE = (message: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Markbase</title>` +
  `<body style="font:16px system-ui;padding:3rem;max-width:32rem;margin:auto">` +
  `<h1 style="font-size:1.25rem">Markbase</h1><p>${message}</p>`;

export interface DeviceAuthOptions {
  /** The Markbase app to authorize against. */
  appUrl: string;
  /**
   * Show the user the authorization page. The CLI and the desktop app both open
   * the SYSTEM browser — never an embedded webview, which Google refuses OAuth in
   * and which wouldn't carry the user's existing session anyway.
   */
  open: (authUrl: string) => void;
  /**
   * Claude Code's version on this machine, if any. Only the device can know this —
   * the browser and the API can't see the user's PATH — and it's recorded on the
   * minted key to unlock the local-agent features.
   */
  claudeVersion?: string | null;
  /**
   * Ask the page to also hand back a one-time session token, so a desktop WINDOW
   * can sign itself in — not just the daemon. The CLI has no window and omits it.
   */
  wantSession?: boolean;
  /**
   * This is a person signing in to their own app, not a CLI being authorised:
   * the page says "Sign in to Markbase" and finishes on its own. Without it the
   * browser shows "Connect the markbase CLI" with a capability picker and an
   * "Authorize this device" button — and a person who just signed in sits there
   * waiting for the app, while the page waits for them.
   */
  desktop?: boolean;
  /**
   * End the attempt: the user cancelled, started another one, or closed the
   * window it belongs to.
   *
   * This — not the clock — is how a sign-in is meant to stop early. A person
   * signing in through a browser has no predictable duration: an account picker,
   * a password manager, 2FA on a phone that is in another room. Every fixed
   * budget we picked was wrong for somebody, and the failure looked identical to
   * a bug (a redirect landing on a port nobody is listening on).
   */
  signal?: AbortSignal;
  /**
   * Backstop only — NOT a budget for the user, and nothing should ever hit it.
   *
   * A loopback server and an unresolved promise are the things being protected
   * here. `signal` covers every case where someone is still around to say stop;
   * this covers the attempt nobody ever comes back to, so the port doesn't stay
   * open for the life of the process. Default 30 minutes.
   *
   * `null` means no backstop: the attempt ends only through `signal`. For an
   * app whose window IS the sign-in page that is the right answer — an attempt
   * that expired left the page wired to a port nobody was listening on, so the
   * browser came back to a dead address and the app sat on /login as if nothing
   * had happened. The window closing, a retry, Log out and quit all abort the
   * signal; there is no attempt nobody comes back to.
   */
  timeoutMs?: number | null;
}

/** Thrown when an attempt is stopped through `signal` rather than failing. */
export class DeviceAuthCanceledError extends Error {
  constructor() {
    super("Sign-in canceled.");
    this.name = "DeviceAuthCanceledError";
  }
}

/** What the browser handed back: always a key, plus a session for a windowed app. */
export interface DeviceAuthResult {
  /** The daemon's durable API key. */
  key: string;
  /**
   * A single-use magic-link token the window loads to establish its own session
   * (only when `wantSession` was asked). Null for the CLI.
   */
  session: string | null;
}

/**
 * Tell the server the key reached us, which is what makes it usable.
 *
 * A 404 means the server minted a LIVE key — it predates mint-after-confirm and
 * ignored our `confirm=1`. That is not a failure: the key works, and refusing it
 * would break every device against an older deployment. Anything else is a real
 * failure and must not be swallowed, because a key we cannot confirm is one that
 * will stop working half an hour from now, and finding that out later — when the
 * daemon quietly 401s — is far worse than failing the sign-in here.
 */
async function confirmKey(base: string, key: string): Promise<void> {
  const res = await fetch(`${base}/api/v1/keys/confirm`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
  });
  if (res.ok || res.status === 404) return;
  throw new Error(
    `Could not activate the new key (${res.status}). Please try signing in again.`
  );
}

/**
 * Run the flow and resolve with the minted key (and, if asked, a window session).
 *
 * Ends when the browser comes back, when `signal` says to stop, or — as a last
 * resort for an attempt nobody returns to — when the backstop expires.
 */
export async function awaitDeviceAuth(opts: DeviceAuthOptions): Promise<DeviceAuthResult> {
  const base = opts.appUrl.replace(/\/+$/, "");
  const state = randomUUID();

  return new Promise<DeviceAuthResult>((resolve, reject) => {
    // Every way out closes the server and detaches the abort listener exactly
    // once, so an attempt can't leave a listening port or a live listener behind
    // however it ends.
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onAbort);
      server.close();
      fn();
    };

    const onAbort = (): void => finish(() => reject(new DeviceAuthCanceledError()));

    const timeout =
      opts.timeoutMs === null
        ? undefined
        : setTimeout(
            () => finish(() => reject(new Error("Timed out waiting for browser authorization."))),
            opts.timeoutMs ?? 30 * 60_000
          );

    // Already cancelled before we began — don't open a port at all.
    if (opts.signal?.aborted) {
      clearTimeout(timeout);
      reject(new DeviceAuthCanceledError());
      return;
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const key = url.searchParams.get("key");
      if (!key) {
        res.writeHead(404).end();
        return;
      }
      // A loopback port is open to anything on this machine; only the state we
      // generated proves this redirect is the one we asked for.
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "content-type": "text/html" }).end(PAGE("State mismatch — please try again."));
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(
        PAGE("Authorized ✓ — you can close this tab.")
      );
      const session = url.searchParams.get("session");
      // The key arrives INERT (we asked for it that way with confirm=1) and
      // authenticates nothing until we say it got here. Only now, on this side of
      // the loopback, is that true — which is the whole point: an authorization
      // that ends at a port nobody is listening on leaves a dead key behind
      // instead of a working one in somebody's address bar.
      finish(() => {
        confirmKey(base, key)
          .then(() => resolve({ key, session }))
          .catch(reject);
      });
    });

    // 127.0.0.1, never 0.0.0.0: this port hands out an API key, and it has no
    // business being reachable from the network.
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const callback = `http://127.0.0.1:${port}`;
      // The URL is the page's half of a contract — built there, not here, so
      // the two cannot drift again (see device-auth-contract).
      opts.open(
        authorizeUrl(base, {
          callback,
          state,
          claudeVersion: opts.claudeVersion,
          // Either reason is enough for the page's desktop framing: a window
          // that wants a session, or a person signing into the app with none.
          desktop: Boolean(opts.desktop || opts.wantSession),
          // Ask for a key that starts inert. Opt-in rather than assumed: an older
          // Markbase server ignores the parameter and mints a live key, which
          // this still handles — confirmKey tolerates a 404 for exactly that case.
          confirm: true,
        })
      );
    });

    server.on("error", (e) => finish(() => reject(e)));
  });
}
