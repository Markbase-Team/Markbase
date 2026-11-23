// Which vaults are mounted on this machine — ONE registry, for every Markbase
// process on it.
//
// There used to be two: the `markbase` CLI kept its list in
// ~/.config/markbase/config.json, and the desktop app kept its own in Electron's
// userData. Mount with one and the other saw nothing — so the app could log
// "0 vault(s) mounted" while a vault was demonstrably syncing on disk. Worse,
// two daemons that DID both know about a folder would each claim its files.
//
// The CLI's path wins as the shared one, for two reasons: it doesn't belong to
// any one app (the desktop userData directory is derived from the package name,
// so renaming the package orphans every mount), and it's where existing mounts
// already are, so nobody has to re-mount anything.
//
// Only the vault list is shared. Credentials stay where they were: the CLI's
// plaintext key in this same file, the desktop app's in its own settings.
//
// Because every process writes here, a change must survive another process
// writing at the same moment. See updateMountedVaults.

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { registryPath } from "./markbase-home";
import { dirname, join } from "node:path";

/** A vault mounted here: which cloud vault, and where it lives on this machine. */
export interface MountedVault {
  vaultId: string;
  name: string;
  dir: string;
  /**
   * The account that mounted it — the user id the mounting client's key
   * resolved to. The registry is machine-wide, and until this field existed
   * every process on the machine mounted every entry under whatever key it
   * held. Signing the desktop app into a second account therefore synced the
   * first account's folders under the second account's key (2026-10-30), and
   * uploaded every file in them as a new document.
   *
   * A host mounts only the entries whose owner is the account its key belongs
   * to (see mountsForAccount). Absent on an entry written before owners were
   * recorded; the daemon fills it in on the first sync the API confirms.
   */
  ownerId?: string;
}

/**
 * The one registry every Markbase process on this machine reads and writes.
 *
 * Resolved per call, never captured: MARKBASE_HOME exists so a development
 * build and an installed one can stop competing over one registry and one set
 * of locks, and a constant read at import time defeats that — the value is
 * fixed before anyone can set the variable. (It also made this module
 * untestable: every test in a run shared whichever directory the first import
 * happened to see.)
 */
export function registryFile(): string {
  return registryPath();
}

/**
 * The path, for callers that only want to name it in a message.
 *
 * Kept as a getter-backed constant for the two places in the desktop app that
 * read and print it. Prefer registryFile() in new code.
 */
export const VAULT_REGISTRY_PATH: string = registryPath();

/**
 * The file's shape. We only own `vaults`; the others are named so a writer can
 * see what it must not clobber. Any field not listed here still survives a
 * write, because the merge below spreads the parsed object, not this type.
 */
interface RegistryFile {
  apiKey?: string;
  mirrorDir?: string;
  vaults?: MountedVault[];
  /**
   * The instance this machine talks to, when it is not the hosted app: its URL
   * and the Supabase project it told us it runs on (GET /api/v1/instance). Set
   * by `markbase instance <url>` and by the desktop app's "Connect to a team
   * instance"; read by both at launch. See readSavedInstance.
   */
  appUrl?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  /**
   * Vaults this machine was deliberately told to stop syncing.
   *
   * reclaimVaults reconnects any vault folder it finds in the default home that
   * the registry has forgotten, without asking. "Forgotten" and "deliberately
   * removed" look identical from there, so unmounting a vault whose folder is
   * still in ~/Markbase used to be undone on the next pass — seconds later, now
   * that the supervisor runs reclaim on both hosts.
   *
   * Machine-local, like the mount list itself: unmounting here says nothing
   * about any other machine, and nothing about the vault in the cloud.
   */
  unmounted?: string[];
}

function readFile(): RegistryFile {
  try {
    return JSON.parse(readFileSync(registryFile(), "utf8")) as RegistryFile;
  } catch {
    return {}; // no file yet, or unreadable — no vaults are mounted
  }
}

function isMountedVault(v: MountedVault | null | undefined): v is MountedVault {
  return !!v && typeof v.vaultId === "string" && typeof v.dir === "string";
}

/** The vaults mounted on this machine. */
export function readMountedVaults(): MountedVault[] {
  return (readFile().vaults ?? []).filter(isMountedVault);
}

/** Vaults this machine was told to stop syncing — see RegistryFile.unmounted. */
export function readUnmountedVaults(): string[] {
  return (readFile().unmounted ?? []).filter((id) => typeof id === "string");
}

/** What `markbase instance` and the desktop app record about the instance this machine talks to. */
export interface SavedInstance {
  appUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
}

/**
 * The instance saved here, or null for the hosted app.
 *
 * All three or none: a URL without the project it runs on would send the
 * window to one instance and the live document channel to another, so a
 * registry that names only one of them is read as not naming an instance.
 */
export function readSavedInstance(): SavedInstance | null {
  const { appUrl, supabaseUrl, supabaseKey } = readFile();
  if (
    typeof appUrl === "string" &&
    appUrl &&
    typeof supabaseUrl === "string" &&
    supabaseUrl &&
    typeof supabaseKey === "string" &&
    supabaseKey
  ) {
    return { appUrl, supabaseUrl, supabaseKey };
  }
  return null;
}

/**
 * Write the file in one step: a temporary file, then a rename.
 *
 * A rename within a directory is atomic, so a reader sees either the old file
 * or the new one and never a half-written one. That matters more here than
 * almost anywhere: every process on the machine reads this file, and an
 * unparseable registry reads as "no vaults are mounted" — which is how a torn
 * write becomes every daemon quietly stopping.
 */
function writeAtomic(next: RegistryFile): void {
  const file = registryFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmp, file);
  } catch (e) {
    // Never leave the temporary behind: it sits beside the registry carrying a
    // copy of the API key, and the next reader has no idea what it is.
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        // best effort — the throw below is the thing worth reporting
      }
    }
    throw e;
  }
}

/** Hold the registry across a read-modify-write, or throw if someone else has it. */
function acquireWriteLock(): () => void {
  const lock = join(dirname(registryFile()), "config.lock");
  mkdirSync(dirname(lock), { recursive: true });
  // "wx" fails when the file exists: the lock IS the file's existence, which is
  // atomic at the filesystem level and needs no coordination of its own.
  const fd = openSync(lock, "wx");
  closeSync(fd);
  return () => {
    try {
      unlinkSync(lock);
    } catch {
      // already gone — nothing to release
    }
  };
}

/** How long to keep trying for the lock before deciding the holder is gone. */
const LOCK_WAIT_MS = 2000;
const LOCK_RETRY_MS = 20;

async function withWriteLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    let release: (() => void) | null = null;
    try {
      release = acquireWriteLock();
    } catch {
      if (Date.now() > deadline) {
        // A process that crashed mid-write leaves the lock behind, and refusing
        // to mount anything ever again is worse than proceeding: the write
        // itself is atomic, so the cost of being wrong here is a lost
        // concurrent edit, not a corrupt file.
        const lock = join(dirname(registryFile()), "config.lock");
        try {
          unlinkSync(lock);
        } catch {
          // someone else cleared it first
        }
        continue;
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
      continue;
    }
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * Change the mounted-vault list without losing someone else's change.
 *
 * `next` is handed the list as it is at the moment of writing — read INSIDE the
 * lock, not before it — so a caller that takes time to decide cannot overwrite
 * an entry another process added meanwhile. That is the whole point: mount,
 * unmount and reconcile are all read-modify-write, and the supervisor will run
 * them from both the desktop app and the CLI daemon on every pass.
 */
export async function updateMountedVaults(
  next: (current: MountedVault[]) => MountedVault[] | Promise<MountedVault[]>
): Promise<MountedVault[]> {
  return withWriteLock(async () => {
    const current = readMountedVaults();
    const vaults = await next(current);
    // Re-read inside the lock: the merge must preserve fields we do not own
    // (the API key, the mirror directory) as they are NOW.
    const file = readFile();
    // Mounting is consent, so it undoes a tombstone. Done here rather than in
    // each caller: "mounted" and "unmounted" must not both be true, and that is
    // an invariant of the file, not a thing every writer should have to
    // remember. mountVault and repointVault get it without knowing it exists.
    const mounted = new Set(vaults.map((v) => v.vaultId));
    const unmounted = (file.unmounted ?? []).filter((id) => !mounted.has(id));
    writeAtomic({ ...file, vaults, unmounted });
    return vaults;
  });
}

// writeMountedVaults used to sit here, "kept for callers that already hold the
// whole list and have nothing to merge". There is no such caller: a list is
// always held from a read taken earlier, and the gap between that read and the
// write is where the other client's mount goes missing. Every writer now hands
// over a change through updateMountedVaults, which applies it under the lock.

/**
 * Is this mount the given account's to sync?
 *
 * Three answers are "yes": the entry names this account; the entry names no
 * account yet (a mount from before owners were recorded — the daemon's own
 * check, against the marker and the API, is what guards those); or the host
 * does not know who its key belongs to (offline on the first launch after an
 * upgrade — again the daemon decides, and offline it writes nothing). Only an
 * entry that names a DIFFERENT account is "no", and that one is never started
 * and never shown.
 */
export function mountedByAccount(v: MountedVault, ownerId: string | null): boolean {
  return v.ownerId === undefined || ownerId === null || v.ownerId === ownerId;
}

/** The mounts a host signed in as `ownerId` may sync and show. */
export function mountsForAccount(all: MountedVault[], ownerId: string | null): MountedVault[] {
  return all.filter((v) => mountedByAccount(v, ownerId));
}

/**
 * Record which account a mount belongs to, once the daemon has confirmed it.
 *
 * Only an entry with no owner is written: an entry that already names one is
 * either right or a different account's, and a daemon that reached this call
 * has already refused the latter. Best-effort — the marker in the folder
 * carries the same fact, and the next confirmed sync tries again.
 */
export async function setMountedVaultOwner(vaultId: string, ownerId: string): Promise<void> {
  await updateMountedVaults((current) =>
    current.map((v) => (v.vaultId === vaultId && v.ownerId === undefined ? { ...v, ownerId } : v))
  );
}

/** Where `vaultId` is mounted on this machine, or null if it isn't. */
export function findMountedVaultDir(vaultId: string): string | null {
  return readMountedVaults().find((v) => v.vaultId === vaultId)?.dir ?? null;
}

/**
 * Add or replace a mount, keyed by vault id — a vault is mounted in exactly one
 * place, so re-mounting moves it rather than listing it twice.
 */
export async function addMountedVault(vault: MountedVault): Promise<void> {
  await updateMountedVaults((current) => [
    ...current.filter((v) => v.vaultId !== vault.vaultId),
    vault,
  ]);
}

/**
 * Remove a mount, without recording a decision about it.
 *
 * For removals that are not the user saying "stop syncing this here" — the
 * desktop's trashVault uses it, where the vault was deleted in the CLOUD. A
 * tombstone there would outlive the vault it names, and reclaim cannot bring it
 * back anyway: the cloud list no longer mentions it. Use unmountVault for a
 * deliberate unmount.
 */
export async function removeMountedVault(vaultId: string): Promise<void> {
  await updateMountedVaults((current) => current.filter((v) => v.vaultId !== vaultId));
}

/**
 * Stop syncing a vault here, and remember that it was deliberate.
 *
 * The tombstone is what makes an unmount stick: without it reclaimVaults sees a
 * vault folder still sitting in the default home, decides the registry has
 * forgotten it, and mounts it again — see RegistryFile.unmounted. Both halves
 * land in one locked write, so a reader can never see the mount gone while the
 * tombstone is missing, which is the window where a reclaim would undo it.
 */
export async function unmountVault(vaultId: string): Promise<void> {
  await withWriteLock(async () => {
    const file = readFile();
    const vaults = (file.vaults ?? []).filter(isMountedVault).filter((v) => v.vaultId !== vaultId);
    const unmounted = file.unmounted ?? [];
    writeAtomic({
      ...file,
      vaults,
      unmounted: unmounted.includes(vaultId) ? unmounted : [...unmounted, vaultId],
    });
  });
}

/**
 * Point this machine (CLI and desktop app alike) at an instance.
 *
 * Under the lock and merged into the file as it is NOW, like every other
 * write here: the key, the mirror directory and the mount list are the other
 * clients' to keep, and a vault mounted while the person was typing a URL
 * must still be there afterwards.
 */
export async function saveInstance(instance: SavedInstance): Promise<void> {
  await withWriteLock(() => {
    writeAtomic({ ...readFile(), ...instance });
  });
}

/**
 * Fold vaults from a process's own legacy list into the shared registry.
 *
 * Returns the ids adopted, so the caller can log what moved and clear its own
 * copy. Entries already in the registry are left alone — the registry is the
 * truth, and a stale private copy must not overwrite it.
 */
export async function adoptLegacyVaults(legacy: MountedVault[]): Promise<string[]> {
  const adopted: string[] = [];
  // A stale private list naming a vault the user has since unmounted would put
  // it back — the same bug reclaim had, wearing a different coat.
  const tombstoned = new Set(readUnmountedVaults());
  await updateMountedVaults((current) => {
    const known = new Set(current.map((v) => v.vaultId));
    const adopt = legacy
      .filter(isMountedVault)
      .filter((v) => !known.has(v.vaultId) && !tombstoned.has(v.vaultId));
    adopted.push(...adopt.map((v) => v.vaultId));
    return adopt.length ? [...current, ...adopt] : current;
  });
  return adopted;
}
