import type { Operator } from "./operator";

// Sign this machine in.
//
// Both clients already wrap the same awaitDeviceAuth: look for a key, and if
// there isn't one, open a browser, wait for it to come back, store what it
// hands over. The desktop asks with a dialog and then hands its window a
// session; the CLI prints a line and then offers to install a skill. Those ends
// stay with their hosts. The middle is here.
//
// What is new is the machine with no browser. Both hosts open a loopback on
// localhost and wait for a redirect to it — which, on a server reached over
// SSH, nobody can produce: the browser is on a different computer, and
// /cli-auth/approve only accepts a loopback callback. The CLI half-admitted
// this in an error path, after the wait. Here it is checked first, and the
// answer is the instruction that actually works.

export interface DeviceAuthRun {
  open: (authUrl: string) => void;
  wantSession?: boolean;
}

export interface SignInDeps {
  operator: Operator;
  /** The key this machine already has, from wherever this host keeps it. */
  readKey: () => string | null;
  /** Persist a newly minted key. */
  storeKey: (key: string) => void;
  /** Run the browser handshake. Injected so a test never opens a port. */
  deviceAuth: (run: DeviceAuthRun) => Promise<{ key: string; session: string | null }>;
  /** Show the authorization page. The host decides how; a window, or the system browser. */
  openAuthPage?: (authUrl: string) => void;
  /** False on a machine nobody is sitting at. */
  canOpenBrowser?: boolean;
  /** Named in the "signed in" line, so someone looking for the credential can find it. */
  keyLocation?: string;
  /** Ask the page for a one-time session token too — a host with a window needs one. */
  wantSession?: boolean;
  /**
   * What the person is asked before the browser opens. Defaults to the
   * desktop's wording. `null` asks nothing: the person already chose — they
   * pressed Sign in, ran `markbase login`, or the window has no key and the
   * only thing it can show is the sign-in page. A dialog in front of that is
   * a second question with one answer, and on the desktop it is modal: the
   * whole app waits behind it, window blank, until someone finds it.
   */
  question?: { action: string; detail?: string; confirmLabel?: string } | null;
}

export type SignInResult =
  | { ok: true; key: string; session: string | null; alreadyHadKey: boolean }
  | {
      ok: false;
      reason: "declined" | "canceled" | "no-browser" | "failed";
      message?: string;
    };

export async function signIn(deps: SignInDeps): Promise<SignInResult> {
  const { operator, readKey, storeKey, deviceAuth } = deps;

  const existing = readKey();
  if (existing) {
    return { ok: true, key: existing, session: null, alreadyHadKey: true };
  }

  // Checked before asking anything. A prompt whose only outcome is a wait for a
  // redirect that cannot arrive is worse than the instruction.
  if (deps.canOpenBrowser === false) {
    operator.reportEvent({
      level: "error",
      message:
        "No browser on this machine, and signing in needs one. Create a key in " +
        "the dashboard under API keys, then set MARKBASE_API_KEY and try again.",
    });
    return { ok: false, reason: "no-browser" };
  }

  if (deps.question !== null) {
    const q = deps.question ?? {
      action: "Sign in to Markbase",
      detail:
        "Markbase needs to know whose documents these are before it can sync. " +
        "Your files stay where they are either way — signing in only connects " +
        "them to your account.",
      confirmLabel: "Sign in",
    };
    if (!(await operator.approve(q))) return { ok: false, reason: "declined" };
  }

  try {
    const { key, session } = await deviceAuth({
      open: deps.openAuthPage ?? (() => {}),
      wantSession: deps.wantSession,
    });
    storeKey(key);
    operator.reportEvent({
      level: "info",
      message: deps.keyLocation
        ? `Signed in — key stored in ${deps.keyLocation}`
        : "Signed in.",
    });
    return { ok: true, key, session, alreadyHadKey: false };
  } catch (e) {
    // Matched by name rather than by class: importing DeviceAuthCanceledError
    // would pull core's device-auth — which opens a port — into this package for
    // the sake of an instanceof.
    if (e instanceof Error && e.name === "DeviceAuthCanceledError") {
      // Cancelled, not failed. The person retried, closed the window, or quit,
      // and there is nobody to tell.
      return { ok: false, reason: "canceled" };
    }
    const message = e instanceof Error ? e.message : String(e);
    // Said out loud, not left in a log. A sign-in that failed silently looks
    // identical from the outside to one still in progress.
    operator.reportEvent({
      level: "error",
      message: `Sign-in didn't finish: ${message}`,
    });
    return { ok: false, reason: "failed", message };
  }
}
