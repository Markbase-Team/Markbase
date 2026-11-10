// The ticket worker, as the desktop app hosts it.
//
// `markbase start` runs the same engine (@markbase/runner) from a terminal or a
// launchd service. Here it runs inside the app's main process, next to the vault
// daemons, for the same reason they do: a person who installed the DMG and
// nothing else should get tickets run on their machine. The app ships its own
// Claude (claude-bin.ts), so that person has never installed Claude Code either.
//
// The worker's life follows the key, not the window. The window can be closed
// — the app lives on in the menu bar — and tickets keep running; Log out stops
// them; the next sign-in starts them. One loop for the life of the process,
// which starts a worker whenever there is a key to run it under and stands
// down when there is not. That mirrors the vault supervisor: a key arriving is
// a fact the loop notices, not an event it has to be told about — though
// `poke` lets the host say "now" rather than wait a tick.

import { runTicketWorker, RUNNER_VERSION, type WorkerState } from "@markbase/runner";

export interface TicketWorkerDeps {
  /**
   * The web app. It is the worker's only upstream: since security lockdown
   * stage 2 the engine reaches jobs, tickets and agent requests through the
   * API with the key below, and holds no database credential at all.
   */
  appUrl: string;
  /** The key to run under right now, or null when signed out. Read every pass. */
  readApiKey: () => string | null;
  /** The bundled Claude, or null if this build shipped without one. */
  claudeBin: () => string | null;
  /** The folders a repo scan may look in: this account's mounted vaults. */
  mountedDirs: () => string[];
  log: (message: string) => void;
  /** How long to wait before looking again — for a key, or after a failure. */
  retryMs?: number;
}

/** What the tray says about tickets. */
export type TicketWorkerStatus =
  | { kind: "signed-out" }
  | { kind: "no-claude" }
  /** Another Markbase process on this machine has the worker lock. */
  | { kind: "waiting"; holder: string }
  | { kind: "idle" }
  | { kind: "job"; ticketId: string }
  /** The worker threw (a key the API refused, say) and will be retried. */
  | { kind: "failed"; message: string };

export interface TicketWorkerHost {
  status: () => TicketWorkerStatus;
  /** Stop the running worker. The loop then waits for a key — Log out. */
  stopRun: () => void;
  /** A key just arrived: look now, not at the next tick. */
  poke: () => void;
  /** Stop for good — quit. */
  stop: () => void;
}

export function startTicketWorkerHost(deps: TicketWorkerDeps): TicketWorkerHost {
  const retryMs = deps.retryMs ?? 10_000;
  let status: TicketWorkerStatus = { kind: "signed-out" };
  let run: AbortController | null = null;
  let stopped = false;
  let wake: (() => void) | null = null;

  // A sleep the host can cut short (poke, stop).
  const nap = (): Promise<void> =>
    new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
      const timer = setTimeout(done, retryMs);
      wake = done;
    });

  // Say a failure once, not every retry: a revoked key would otherwise write
  // the same line into vault.log every ten seconds for as long as the app is
  // open. Said again only if the message changes, or after a run that worked.
  let saidFailure: string | null = null;

  void (async () => {
    while (!stopped) {
      const apiKey = deps.readApiKey();
      if (!apiKey) {
        status = { kind: "signed-out" };
        await nap();
        continue;
      }
      const claudeBin = deps.claudeBin();
      if (!claudeBin) {
        status = { kind: "no-claude" };
        if (saidFailure !== "no-claude") {
          saidFailure = "no-claude";
          deps.log("tickets: this build has no Claude binary — not running tickets");
        }
        await nap();
        continue;
      }

      const attempt = new AbortController();
      run = attempt;
      status = { kind: "idle" };
      try {
        await runTicketWorker({
          appUrl: deps.appUrl,
          apiKey,
          // What this engine can do — see @markbase/runner/version. The app's
          // own version is the DMG's and says nothing about tickets.
          version: RUNNER_VERSION,
          claudeBin,
          // One worker per machine: the CLI service and this app on one Mac
          // take turns rather than both claiming the owner's jobs.
          lockOwner: "desktop app",
          // Not installed from npm; `markbase update` is not our upgrade path.
          checkForUpdates: false,
          discoverWithin: deps.mountedDirs,
          signal: attempt.signal,
          log: (m) => deps.log(`[tickets] ${m}`),
          onState: (s: WorkerState) => {
            status = s.kind === "waiting" ? { kind: "waiting", holder: s.holder.owner } : s;
          },
        });
        saidFailure = null;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        status = { kind: "failed", message };
        if (saidFailure !== message) {
          saidFailure = message;
          deps.log(`tickets: worker stopped — ${message}; trying again in ${Math.round(retryMs / 1000)}s`);
        }
      } finally {
        run = null;
      }
      // Stopped on purpose: look again at once, so a Log out reads as signed
      // out now rather than after a retry's worth of waiting. A failure waits.
      if (!attempt.signal.aborted) await nap();
    }
  })();

  return {
    status: () => status,
    stopRun: () => run?.abort(),
    poke: () => wake?.(),
    stop: () => {
      stopped = true;
      run?.abort();
      wake?.();
    },
  };
}
