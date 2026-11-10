// One loop that makes the registry true.
//
// Mounting a vault is an edit to a file: it says this vault belongs in this
// folder on this machine. Nothing about that starts a daemon. The supervisor is
// what closes the gap — it reads the declared mounts, compares them against the
// daemons it is running, and starts, stops or restarts until the two agree.
//
// Both hosts had half of this and neither had the whole thing. The desktop kept
// a Map of stop handles and drove it from its own mount/unmount handlers, so it
// worked, but only for changes made inside that process. The CLI started a
// daemon per vault at launch and never looked again, which is why `markbase
// vault unmount` left the daemon running until the service restarted.
//
// The case neither host had is the interesting one. A vault's lock is held by
// whichever process got there first, so on a machine running both the desktop
// app and the CLI daemon, one of them is refused. Both treated that as fatal for
// that vault and never tried again — so quitting the desktop app left the CLI
// permanently not syncing vaults that were now free. Locked is a normal state
// here, not an error: we keep the vault in the desired set and try again.

import type { MountedVault } from "@markbase/vault/vault-registry";

/** Stop a running daemon. What startVaultSync hands back. */
type StopSync = () => Promise<void>;

export interface SupervisorDeps {
  /** The declared mounts, read fresh on every pass. */
  readMounted: () => MountedVault[];
  /** Start syncing one vault; resolve with its stop handle. */
  startSync: (vault: MountedVault) => Promise<StopSync>;
  /** Where the host's messages go. */
  log?: (message: string) => void;
  /**
   * How often to look again without being asked. Covers the two things nobody
   * tells us about: a registry edited by another process, and a lock released
   * when the other host quits.
   */
  retryMs?: number;
}

export interface VaultSupervisor {
  /** Resolves when the first pass has finished. */
  settled: () => Promise<void>;
  /** Run a pass now — after this host edits the registry itself. */
  reconcile: () => Promise<void>;
  /**
   * The vault ids actually syncing here — not the declared ones.
   *
   * A vault held by the other host is desired but not running, and a host that
   * blocks its own shutdown waiting for a daemon it never started would hang on
   * quit. The desktop's before-quit handler asks this before preventing default.
   */
  running: () => string[];
  /** Stop every daemon and the loop. */
  stop: () => Promise<void>;
}

/** A daemon this supervisor is running, and the folder it was started for. */
interface Running {
  stop: StopSync;
  dir: string;
}

export function startVaultSupervisor(deps: SupervisorDeps): VaultSupervisor {
  const log = deps.log ?? (() => {});
  const running = new Map<string, Running>();
  // What we last said about each vault, so we can avoid saying it twice.
  //
  // A supervisor that logs on every pass writes the same sentence into the log
  // forever — every few seconds, per vault, for as long as the condition lasts.
  // One that never logs leaves you wondering why a mounted vault isn't syncing.
  // So: say it when it changes. A vault that starts cleanly is forgotten here,
  // which is what makes a later failure worth reporting again.
  const reported = new Map<string, string>();
  function reportOnce(vaultId: string, line: string): void {
    if (reported.get(vaultId) === line) return;
    reported.set(vaultId, line);
    log(line);
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Passes are serialised. Two overlapping reconciles would both see a vault as
  // not-running and start it twice, and the second daemon would be refused by
  // its own lock — a race that only shows up under exactly the conditions this
  // loop exists for.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (fn: () => Promise<void>): Promise<void> => {
    chain = chain.then(fn, fn);
    return chain;
  };

  async function stopOne(vaultId: string): Promise<void> {
    const entry = running.get(vaultId);
    if (!entry) return;
    running.delete(vaultId);
    try {
      await entry.stop();
    } catch (e) {
      // A daemon that fails to stop cleanly must not strand the rest of the
      // pass: it is already out of the map, so the next pass will start a fresh
      // one if the vault is still declared.
      log(`${vaultId}: stopping failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function startOne(vault: MountedVault): Promise<void> {
    try {
      const stop = await deps.startSync(vault);
      running.set(vault.vaultId, { stop, dir: vault.dir });
      reported.delete(vault.vaultId);
    } catch (e) {
      // Matched by name rather than by importing VaultLockedError: the class
      // lives in @markbase/vault, and importing it here would drag the
      // whole sync engine into every consumer of this module for an instanceof.
      if (e instanceof Error && e.name === "VaultLockedError") {
        // Expected on a machine running both hosts. Stay in the desired set.
        reportOnce(
          vault.vaultId,
          `${vault.name}: another Markbase process has this vault — will take over when it lets go`
        );
        return;
      }
      // Everything else — no API key, a folder that is gone, a full disk. These
      // persist across passes too, so they get the same treatment.
      reportOnce(vault.vaultId, `${vault.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function pass(): Promise<void> {
    if (stopped) return;
    const declared = deps.readMounted();
    const byId = new Map(declared.map((v) => [v.vaultId, v]));

    // Gone from the registry, or moved to a different folder. A moved vault has
    // to be restarted rather than left alone: the running daemon is watching
    // the old directory, so following the move means stopping and starting.
    for (const [vaultId, entry] of [...running]) {
      const declaredVault = byId.get(vaultId);
      if (!declaredVault || declaredVault.dir !== entry.dir) {
        await stopOne(vaultId);
      }
    }

    for (const vault of declared) {
      if (stopped) return;
      if (running.has(vault.vaultId)) continue;
      await startOne(vault);
    }
  }

  function scheduleNext(): void {
    if (stopped || !deps.retryMs) return;
    timer = setTimeout(() => {
      void enqueue(pass).then(scheduleNext);
    }, deps.retryMs);
    // Deliberately NOT unref'd, which is a mistake worth recording. Unref'ing
    // looks tidy — don't hold the process open on our own account — but this
    // timer is the pending work, not a background nicety. On a machine where
    // every vault's lock is held elsewhere the supervisor starts no daemons, so
    // it owns the only handle in the event loop; unref'd, `markbase vault-sync`
    // printed "will take over when it lets go" and then exited on the spot,
    // promising exactly the thing it had just made impossible. A host that
    // wants to exit calls stop(), which clears this.
  }

  const first = enqueue(pass).then(scheduleNext);

  return {
    settled: () => first,
    reconcile: () => enqueue(pass),
    running: () => [...running.keys()],
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Stop every daemon NOW, not queued behind the in-flight reconcile pass.
      // A pass caught mid network request — a doc fetch, an asset transfer — can
      // take seconds to return or time out, and `enqueue` here would wait for it
      // before tearing anything down. That wait is what made the desktop app
      // slow to quit. `stopped` is already set, so that pass bails at its next
      // checkpoint and starts nothing new; meanwhile each daemon's own stop
      // (closing its file watcher and documents, releasing its lock) is local
      // and immediate. A cloud push cut short this way reconverges next launch —
      // the store is a CRDT, and the disk, not the pass, is the source of truth.
      await Promise.all([...running.keys()].map(stopOne));
    },
  };
}

