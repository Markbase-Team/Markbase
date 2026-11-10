import {
  DEFAULT_APP_URL,
  fetchInstance,
  normalizeInstanceUrl,
  type InstanceFetch,
} from "@markbase/protocol/instance";
import type { SavedInstance } from "@markbase/vault";

// Connecting this app to a team's instance (SELF-HOSTING.md) — the decision
// half, with no Electron in it so a test can drive it.
//
// The instance is read ONCE at launch: APP_URL and the Supabase pair are
// module constants in main.ts, handed to every window's preload and to the
// daemons, and all of them must agree on one instance for the life of the
// process. So a change is not a variable assignment; it is a save followed by a
// relaunch, and the new process comes up on the new instance the way a launch
// after `markbase instance <url>` always has.

/** What the onboarding page shows about where this app points. */
export interface InstanceStatus {
  /** Where the window and the daemons talk to, as this process was launched. */
  appUrl: string;
  /** True for the hosted app — the one a fresh install talks to. */
  isDefault: boolean;
  /**
   * APP_URL was set in the environment: it wins over the saved instance, so
   * what is connected here is saved but does not take effect until it is unset.
   */
  fromEnv: boolean;
}

export type InstanceConnectResult =
  /** Saved and relaunching onto it. `appUrl` is the normalized URL. */
  | { ok: true; appUrl: string; changed: true }
  /** Already on this instance: nothing saved, no relaunch. */
  | { ok: true; appUrl: string; changed: false }
  | { ok: false; error: string };

export interface InstanceDeps {
  /** The instance this process runs against. */
  current: SavedInstance;
  /** Write the three keys into the shared registry; must keep the others. */
  save: (instance: SavedInstance) => Promise<void>;
  /**
   * Forget this app's own key, and that it was asked for: a key belongs to one
   * instance, and the CLI's key in the registry is that instance's too, so it
   * must not be borrowed on the new one either (Settings.signedOut in main.ts).
   */
  forgetKey: () => void;
  /** Exit and come back up — on the instance just saved. */
  relaunch: () => void;
  log: (message: string) => void;
  /** Injected for tests; defaults to the real one. */
  fetchImpl?: InstanceFetch;
}

export function instanceStatus(appUrl: string, fromEnv: boolean): InstanceStatus {
  return { appUrl, isDefault: appUrl === DEFAULT_APP_URL, fromEnv };
}

/**
 * Point this app at `raw`: ask the instance which project it runs on, save the
 * answer, drop the key, relaunch. Nothing is written until the instance has
 * answered, so a typo leaves the previous instance in place and the app running.
 *
 * Resolves rather than throws: the answer crosses IPC to a page, and an Error
 * does not survive that trip with its message intact.
 */
export async function connectToInstance(
  raw: string,
  deps: InstanceDeps
): Promise<InstanceConnectResult> {
  let appUrl: string;
  try {
    appUrl = normalizeInstanceUrl(raw);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let next: SavedInstance;
  try {
    const info = await fetchInstance(appUrl, deps.fetchImpl);
    next = {
      appUrl,
      supabaseUrl: info.supabase_url,
      supabaseKey: info.supabase_publishable_key,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    deps.log(`instance: ${appUrl} not connected — ${error}`);
    return { ok: false, error };
  }
  const { current } = deps;
  if (
    next.appUrl === current.appUrl &&
    next.supabaseUrl === current.supabaseUrl &&
    next.supabaseKey === current.supabaseKey
  ) {
    // Typing the instance the app is already on is not a change, and
    // relaunching — losing the key, closing every window — for it would be a
    // punishment for checking.
    return { ok: true, appUrl, changed: false };
  }
  try {
    await deps.save(next);
  } catch (e) {
    const error = `Could not save the instance (${e instanceof Error ? e.message : String(e)}).`;
    deps.log(`instance: ${error}`);
    return { ok: false, error };
  }
  deps.forgetKey();
  deps.log(`instance: ${current.appUrl} → ${appUrl} (project ${next.supabaseUrl}); relaunching`);
  deps.relaunch();
  return { ok: true, appUrl, changed: true };
}
