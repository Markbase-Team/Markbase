// One syncing process per vault, per machine.
//
// The same sync engine has two hosts: the desktop app runs it inside Electron's
// main process, and the `markbase` CLI runs it standalone (often as a launchd or
// systemd service, so it survives the app being closed). Nothing stopped both
// from claiming one folder at once.
//
// Two daemons on one vault do not corrupt each other — they converge through the
// CRDT like any other pair of peers. What they do instead is fight over
// FILENAMES: each materializes documents, each sees the other's writes as
// unexplained files, and a document with a contested name gets renamed back and
// forth for as long as both are running. That is the same rename churn that
// filled the log every 15 seconds.
//
// So: a lock, taken before a vault starts syncing and released when it stops.
//
// MACHINE-scoped, deliberately — it lives beside the config, not inside the
// vault. The thing being prevented is two processes on ONE computer opening one
// folder. Two computers each syncing their own copy of a vault is the entire
// point of the product, and a lock inside the vault folder would travel with it
// (through git, or a synced drive) and wrongly block the other machine.
//
// The ticket worker holds one of these too (acquireWorkerLock). Same two hosts,
// same shape of problem: both ran the worker, both claimed the owner's jobs, and
// which one ran a ticket depended on whose poll fired first — with the CLI
// service's repos and Claude login, or the app's bundled Claude. One worker per
// machine, and the other waits for it to let go, exactly as a vault does.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { locksDir } from "./markbase-home";
import { dirname, join } from "node:path";

/** Who is holding a vault. */
export interface VaultLockInfo {
  /** "desktop" or "cli" — named in the message the loser prints. */
  owner: string;
  pid: number;
  /** Refreshed while syncing; a lock that stops ticking is abandoned. */
  heartbeat: number;
  since: number;
}

/** A lock that has not been refreshed for this long belongs to nobody. */
const STALE_MS = 60_000;
/** How often the holder proves it is alive. Well inside STALE_MS. */
const HEARTBEAT_MS = 15_000;

function lockPath(vaultId: string): string {
  return join(locksDir(), `${vaultId.replace(/[^a-zA-Z0-9-]/g, "")}.json`);
}

function read(vaultId: string): VaultLockInfo | null {
  try {
    return JSON.parse(readFileSync(lockPath(vaultId), "utf8")) as VaultLockInfo;
  } catch {
    return null; // absent or unreadable — nobody holds it
  }
}

/**
 * Is that process still running? A crashed holder must not block forever.
 *
 * EPERM counts as alive: it means the process EXISTS but belongs to another
 * user, so we may not signal it. Reading that as "dead" would steal the lock
 * from a perfectly healthy daemon running under a different account.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 tests for existence, sends nothing
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Thrown when another process on this machine already holds the lock. */
export class VaultLockedError extends Error {
  constructor(
    readonly holder: VaultLockInfo,
    message = `already being synced by the ${holder.owner} (pid ${holder.pid}) on this machine`
  ) {
    super(message);
    this.name = "VaultLockedError";
  }
}

export interface VaultLock {
  release(): void;
  /**
   * Prove we are still here, and find out whether we still hold the vault.
   * Returns false once the lock belongs to someone else — after which it is
   * inert and `onLost` has already fired.
   *
   * Called on every heartbeat; exposed so a caller can check on demand.
   */
  heartbeat(): boolean;
}

/**
 * Does the lock file still say this process holds the vault?
 *
 * A record naming a holder that is dead or has stopped ticking is not a loss —
 * it is the same abandoned lock `acquireVaultLock` is willing to take over, and
 * refusing it here would let a crashed peer retire a healthy daemon.
 */
function stillOurs(vaultId: string): boolean {
  const now = read(vaultId);
  if (!now || now.pid === process.pid) return true; // ours, or nobody's
  const fresh = Date.now() - now.heartbeat < STALE_MS;
  return !(fresh && alive(now.pid));
}

/**
 * Claim `vaultId` for this process, or throw `VaultLockedError`.
 *
 * A lock is taken over when its holder is gone (the pid no longer exists) or has
 * stopped refreshing — a process killed with SIGKILL leaves the file behind, and
 * that must not lock a vault out permanently.
 *
 * `onLost` fires if the vault is taken from us WHILE WE RUN. The lock used to be
 * checked once, at startup, and only ever written afterwards — so the process
 * that lost a takeover was never told, and kept syncing. That is not a hypothetical:
 * a vault was found being synced by a CLI daemon whose lock file named a desktop
 * app that had since died — the desktop app took the lock, exited, and the CLI
 * carried on holding nothing, which is exactly the two-daemons-one-folder state
 * the lock exists to prevent. A heartbeat that only writes cannot detect this;
 * it has to read first.
 */
export function acquireVaultLock(
  vaultId: string,
  owner: string,
  onLost?: (holder: VaultLockInfo) => void
): VaultLock {
  return acquire(vaultId, owner, onLost, (held) => new VaultLockedError(held));
}

/**
 * The lock file the ticket worker holds. Not a vault id, and chosen so no vault
 * id can collide with it: ids are UUIDs, and this has no hex in the places a
 * UUID would.
 */
const WORKER_LOCK = "ticket-worker";

/**
 * Claim this machine's ticket worker for this process, or throw
 * `VaultLockedError` naming who has it. Same rules as a vault: a holder that
 * is dead or has stopped ticking is abandoned and taken over, and `onLost`
 * fires if someone else takes it from us while we run.
 */
export function acquireWorkerLock(
  owner: string,
  onLost?: (holder: VaultLockInfo) => void
): VaultLock {
  return acquire(
    WORKER_LOCK,
    owner,
    onLost,
    (held) =>
      new VaultLockedError(
        held,
        `tickets are already being run by the ${held.owner} (pid ${held.pid}) on this machine`
      )
  );
}

function acquire(
  name: string,
  owner: string,
  onLost: ((holder: VaultLockInfo) => void) | undefined,
  refuse: (held: VaultLockInfo) => VaultLockedError
): VaultLock {
  const vaultId = name;
  const held = read(vaultId);
  if (held && held.pid !== process.pid) {
    const fresh = Date.now() - held.heartbeat < STALE_MS;
    if (fresh && alive(held.pid)) throw refuse(held);
    // else: stale or dead — ours to take
  }

  // When WE took it — fixed at acquisition, not recomputed. `held` is the state
  // from before we claimed it, so leaving this inside `write` reset `since` to
  // Date.now() on every heartbeat: the field that says how long a vault has been
  // syncing always read "just now", which is exactly when you go looking at it.
  const since = held?.pid === process.pid ? held.since : Date.now();

  const write = (): void => {
    const info: VaultLockInfo = {
      owner,
      pid: process.pid,
      heartbeat: Date.now(),
      since,
    };
    mkdirSync(dirname(lockPath(vaultId)), { recursive: true });
    writeFileSync(lockPath(vaultId), JSON.stringify(info, null, 2));
  };
  write();

  let released = false;
  let lost = false;

  const heartbeat = (): boolean => {
    if (released || lost) return false;
    if (!stillOurs(vaultId)) {
      lost = true;
      clearInterval(timer);
      // Deliberately NOT removing the file: it is the new holder's now.
      onLost?.(read(vaultId) as VaultLockInfo);
      return false;
    }
    write(); // re-taking it if an abandoned record was sitting there
    return true;
  };

  const timer = setInterval(heartbeat, HEARTBEAT_MS);
  // Never hold the process open just to say "still here".
  timer.unref?.();

  return {
    heartbeat,
    release(): void {
      if (released) return;
      released = true;
      clearInterval(timer);
      try {
        // Only remove it if it is still ours — a lock we lost to a takeover
        // belongs to somebody else now.
        if (read(vaultId)?.pid === process.pid) rmSync(lockPath(vaultId), { force: true });
      } catch {
        // A leftover file is harmless: it goes stale in a minute.
      }
    },
  };
}
