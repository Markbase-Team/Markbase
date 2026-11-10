import type { MountedVault } from "@markbase/vault/vault-registry";
import type { Operator } from "./operator";

// When the disk and the registry disagree about where a vault lives.
//
// Every vault folder carries a marker naming the vault it holds. The registry is
// the app's memory of the same fact, and it is the one that goes wrong: a reset
// registry, a reinstall, a config copied from another machine, a folder dragged
// somewhere in Finder. The marker travels with the files; the registry does not.
//
// Two flows, differing in one deliberate way:
//
//   reclaimVaults  reconnects a vault folder the registry forgot, WITHOUT
//                  asking. Offering to mount a vault whose files are already on
//                  disk invites answering with a different folder, and then one
//                  vault has two homes.
//
//   repointVault   follows a vault that turned up somewhere unexpected, and
//                  ASKS first, because a folder inside another vault may have
//                  been dragged there by accident.
//
// Both were desktop-only. A daemon on a server could not recover from either.

export interface ReconcileDeps {
  operator: Operator;
  readMounted: () => MountedVault[];
  /**
   * Vaults this machine was deliberately told to stop syncing.
   *
   * reclaim exists to reconnect what the registry forgot, and it cannot tell
   * "forgotten" from "removed on purpose" by looking at the disk — the folder
   * is still there either way, because unmounting deletes nobody's files. This
   * is how it tells them apart.
   */
  readUnmounted: () => string[];
  /**
   * Change the registry, by handing over a change rather than a result.
   *
   * These flows run inside a daemon that reconciles every few seconds, on a
   * machine where the other client is writing the same file. "Read the list,
   * write it back changed" drops whatever landed in between; the mutator runs
   * under the registry's lock instead. Backed by updateMountedVaults.
   */
  updateMounted: (
    next: (current: MountedVault[]) => MountedVault[]
  ) => Promise<MountedVault[]>;
  /** The vault id a folder is marked with, or null. */
  markerOf: (dir: string) => string | null;
  /**
   * The account a folder's marker says mounted it, or null when it does not
   * say (a folder from before owners were recorded). A folder another account
   * mounted is not reconnected: its vault is not in this account's cloud list
   * anyway, but the marker is the cheaper and the earlier test.
   */
  markerOwnerOf?: (dir: string) => string | null;
  /**
   * The account this client's key belongs to, or null when it could not be
   * resolved. Recorded on every entry these flows write, so the mount is this
   * account's from the start rather than from the daemon's first confirmed run.
   */
  keyOwner?: () => string | null;
  /**
   * The vaults this account owns, or null when the answer cannot be trusted.
   *
   * null and [] are different: "I don't know" is not "you have none". Treating
   * an unreachable server as an empty list is how a folder gets reconnected to
   * the wrong account, or a mounted vault gets treated as deleted.
   */
  listCloudVaults: () => Promise<{ id: string; name: string }[] | null>;
  startSync: (vault: MountedVault) => void;
  /** Immediate subdirectories of a folder. */
  listSubdirs: (dir: string) => string[];
  /** Where vaults are put by default, and so where forgotten ones turn up. */
  defaultHome: string;
  /**
   * Release whatever the operator holds — a readline interface keeps the process
   * alive until it is closed. Optional: a host whose operator owns nothing
   * (dialogs, a policy) has nothing to release.
   */
  close?: () => void;
}

/** A vault found somewhere it was not expected: which vault, and where it is now. */
export interface FoundVault {
  vaultId: string;
  /** Absolute path on this machine. */
  dir: string;
}

/**
 * Reconnect vault folders sitting in the default home that the registry forgot.
 *
 * Only one level of `defaultHome` is scanned — the location the folder picker
 * proposes. Searching the whole disk for markers would be slow and presumptuous:
 * a vault deliberately put elsewhere is the owner's to point at again.
 *
 * Returns how many were reconnected.
 */
export async function reclaimVaults(deps: ReconcileDeps): Promise<number> {
  const { operator, readMounted, updateMounted, markerOf, startSync } = deps;

  // Better to reconnect later than to reconnect the wrong thing now.
  const cloud = await deps.listCloudVaults();
  if (cloud === null) return 0;

  // Read once per pass, not per folder: this runs on a timer on both hosts.
  const tombstoned = new Set(deps.readUnmounted());

  let reclaimed = 0;
  for (const dir of deps.listSubdirs(deps.defaultHome)) {
    const vaultId = markerOf(dir);
    if (!vaultId) continue;

    // Mounted here by a different account. Its vault would not be in this
    // account's cloud list either, but the folder says so directly, and a
    // folder that says so is not this account's to touch.
    const markedOwner = deps.markerOwnerOf?.(dir) ?? null;
    const me = deps.keyOwner?.() ?? null;
    if (markedOwner !== null && me !== null && markedOwner !== me) continue;

    // Told to stop syncing this one. Silently: the alternative is announcing
    // the same decision every few seconds for as long as the folder sits there.
    if (tombstoned.has(vaultId)) continue;

    const mounted = readMounted();
    if (mounted.some((m) => m.vaultId === vaultId || m.dir === dir)) continue;

    // Only a vault THIS account owns. A folder left by another user on a shared
    // machine names a vault we cannot read, and mounting it would fail on every
    // sync instead of obviously here.
    const match = cloud.find((c) => c.id === vaultId);
    if (!match) continue;

    const vault: MountedVault = { vaultId, name: match.name, dir };
    // The cloud list is this account's own vaults, so the match IS the
    // confirmation; record whose mount this is while we know.
    if (me) vault.ownerId = me;
    // Checked again inside the lock. Both clients reconcile on a timer, so they
    // scan this same folder at close to the same moment; whoever writes second
    // has to notice and stand down rather than add a second entry for one vault.
    let added = false;
    await updateMounted((current) => {
      if (current.some((m) => m.vaultId === vaultId || m.dir === dir)) return current;
      added = true;
      return [...current, vault];
    });
    if (!added) continue;

    // Not asked, but not hidden either: something changed, and the person
    // should be able to find out why.
    operator.reportEvent({
      level: "info",
      message: `${match.name} is already on disk at ${dir} — reconnected without asking`,
    });
    startSync(vault);
    reclaimed++;
  }
  return reclaimed;
}

/**
 * Offer to follow a vault that turned up somewhere unexpected.
 *
 * `insideName` is the vault whose tree it was found in — the only reason we know
 * where it went, since a folder moved through Finder leaves no trace anywhere
 * else. Returns whether the registry was repointed.
 */
export async function repointVault(
  found: FoundVault,
  insideName: string,
  deps: ReconcileDeps
): Promise<boolean> {
  const { operator, readMounted, updateMounted, startSync } = deps;
  const mounted = readMounted();
  const mine = mounted.find((m) => m.vaultId === found.vaultId);

  // Already pointed where it actually is.
  if (mine && mine.dir === found.dir) return false;

  let name = mine?.name;
  if (!name) {
    // No trustworthy list means we cannot even name it; say nothing rather than
    // guess at what the person is being asked about.
    const cloud = await deps.listCloudVaults();
    if (cloud === null) return false;
    name = cloud.find((c) => c.id === found.vaultId)?.name;
  }
  // Someone else's vault, not ours to offer.
  if (!name) return false;

  const ok = await operator.approve({
    action: mine
      ? `"${name}" isn't where it used to be`
      : `Found your "${name}" vault`,
    detail: `It's at ${found.dir}, inside "${insideName}". Sync it from there?`,
    confirmLabel: "Use this location",
  });
  if (!ok) return false;

  const vault: MountedVault = { vaultId: found.vaultId, name, dir: found.dir };
  // The account stays what it was: repointing moves a mount, it does not
  // change whose it is. A mount with none recorded takes the key's, since
  // the cloud list (or the existing entry) just vouched for it.
  const owner = mine?.ownerId ?? deps.keyOwner?.() ?? null;
  if (owner) vault.ownerId = owner;
  // Against the list as it is now, not as it was before the question was asked:
  // answering takes as long as someone takes to read it.
  await updateMounted((current) => [
    ...current.filter((m) => m.vaultId !== found.vaultId),
    vault,
  ]);
  startSync(vault);
  return true;
}
