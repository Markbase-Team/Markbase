// Which account a vault folder belongs to, and whether this key may sync it.
//
// The mount registry is machine-wide and the folders carry a marker; neither
// said WHOSE vault a folder held, so every Markbase process mounted every entry
// under whatever key it had. Signing the desktop app into a second account on
// the same Mac (2026-10-30) therefore started a daemon per folder under the new
// key, listed each vault as empty — the vaults were not that account's — and
// uploaded every file as a new document into the first account's vaults. Files
// on disk were untouched; the cloud had 116 documents it should not have.
//
// Both halves of the fix live here. The key's owner comes from /api/v1/me; a
// vault's owner comes from /api/v1/vaults/:id, which answers the owner with the
// row, anyone else with a 403, and a vault that no longer exists with a 404.
// The two refusals are kept apart because a daemon does opposite things on
// them: a vault that is gone has its folder retired (the host's deletion check
// does that), a vault that is someone else's is left exactly as it is. A host
// asks before it starts a daemon; the daemon asks again before it writes.
// Owners are recorded lazily — in the registry entry and in the folder's
// marker — so no existing mount has to be touched by hand.

import { fetchWithTimeout } from "@markbase/protocol/timeout-fetch";
import { resolveWorkerConnection } from "@markbase/protocol/worker-connection";
import { isSharedVault } from "@markbase/protocol/shared-vault";
import { readVaultMarkerInfo, writeVaultMarker } from "./vault-fs";
import { readVaultIndex } from "./vault-index";
import { readMountedVaults, setMountedVaultOwner, type MountedVault } from "./vault-registry";

/** A vault this key's account did not mount, so this process must not sync it. */
export class VaultNotOursError extends Error {
  readonly name = "VaultNotOursError";
  constructor(
    readonly vaultId: string,
    /** The account recorded for the mount, when there is one. */
    readonly recordedOwner: string | null,
    /** The account the key belongs to, when it could be resolved. */
    readonly keyOwner: string | null,
    name?: string
  ) {
    super(
      `vault ${name ?? vaultId} was mounted by another account; not syncing` +
        (recordedOwner && keyOwner ? ` (mounted by ${recordedOwner}, signed in as ${keyOwner})` : "")
    );
  }
}

/** A vault the API no longer has: not this key's to sync, and not anyone's. */
export class VaultGoneError extends Error {
  readonly name = "VaultGoneError";
  constructor(readonly vaultId: string, name?: string) {
    super(`vault ${name ?? vaultId} was deleted in the cloud; not syncing — its files stay where they are`);
  }
}

/**
 * What the API says about a vault: whose it is, someone else's, gone, or no
 * usable answer.
 */
export type VaultOwnerAnswer = { ownerId: string } | "not-ours" | "deleted" | null;

/**
 * The account this key belongs to, or null when the API could not say.
 *
 * Null is "unknown", never "nobody": a daemon that cannot resolve its owner
 * must not treat that as licence to sync anything.
 */
export async function resolveKeyOwner(appUrl: string, apiKey: string): Promise<string | null> {
  return (await resolveWorkerConnection(appUrl, apiKey))?.ownerId ?? null;
}

/**
 * Whose vault this is, as far as this key is allowed to know.
 *
 * `GET /vaults/:id`: a 200 carries the vault with its owner_id, so the key's
 * account owns it; a 403 says it exists and is someone else's; a 404 says it no
 * longer exists. Anything else — a timeout, a 500, a malformed body — is not
 * an answer, and the caller is expected to do nothing on it. The Shared Vault
 * is not a row, so it is never asked about.
 */
export async function vaultOwnerPerApi(
  appUrl: string,
  apiKey: string,
  vaultId: string
): Promise<VaultOwnerAnswer> {
  if (isSharedVault(vaultId)) return null;
  try {
    const res = await fetchWithTimeout(`${appUrl}/api/v1/vaults/${encodeURIComponent(vaultId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 403) return "not-ours";
    if (res.status === 404) return "deleted";
    if (!res.ok) return null;
    const body = (await res.json()) as { vault?: { id?: string; owner_id?: string } };
    const ownerId = body.vault?.owner_id;
    return typeof ownerId === "string" && ownerId.length > 0 ? { ownerId } : null;
  } catch {
    return null;
  }
}

/**
 * Has this Shared Vault folder ever synced anything? One that has holds some
 * account's shared documents, and only that account's listing can say whose —
 * so it is not bound to a key on sight (see the daemon's overlap check). One
 * that has not belongs to whoever mounts it.
 */
export function sharedFolderHasDocs(dir: string): boolean {
  const index = readVaultIndex(dir);
  return !!index && isSharedVault(index.vaultId) && index.docs.length > 0;
}

/**
 * The owner the registry and the folder have recorded for a mount, if either
 * has. The registry first: it is this machine's own file, and reading it
 * touches nothing of the person's. The folder's marker is read only when the
 * registry has no answer — and never for a mount the registry already says is
 * another account's, which is how three vault folders under ~/Documents
 * stopped prompting for access on a launch that was never going to sync them.
 */
export function recordedOwnerOf(v: { vaultId: string; dir: string; ownerId?: string }): string | null {
  if (v.ownerId) return v.ownerId;
  const registry = readMountedVaults().find((m) => m.vaultId === v.vaultId)?.ownerId;
  if (registry) return registry;
  const marker = readVaultMarkerInfo(v.dir);
  return marker && marker.vaultId === v.vaultId && marker.ownerId ? marker.ownerId : null;
}

/**
 * Write the account down where the next process will look: the registry
 * entry, and the folder's marker. Best-effort — the API will confirm it again
 * on the next run if either write is lost.
 */
export async function recordMountOwner(vaultId: string, dir: string, ownerId: string): Promise<void> {
  const marker = readVaultMarkerInfo(dir);
  if (!(marker && marker.vaultId === vaultId && marker.ownerId === ownerId)) {
    try {
      writeVaultMarker(dir, vaultId, ownerId);
    } catch {
      // the registry entry below still carries it
    }
  }
  const entry = readMountedVaults().find((m) => m.vaultId === vaultId);
  if (entry && entry.ownerId === undefined) {
    try {
      await setMountedVaultOwner(vaultId, ownerId);
    } catch {
      // the marker above still carries it
    }
  }
}

export interface ConfirmMountDeps {
  appUrl: string;
  apiKey: string;
  /** The account the key belongs to, if the host already resolved it. */
  keyOwner: string | null;
  /** Seam for tests; defaults to the API. */
  vaultOwner?: (vaultId: string) => Promise<VaultOwnerAnswer>;
}

/**
 * May this key sync this mount? Decided by the HOST, before any daemon starts.
 *
 * Returns the account the mount belongs to once that is settled — recording it
 * if it was not — or null when it could not be settled right now (offline),
 * which the caller treats as "not yet": the supervisor asks again on its next
 * pass. Throws VaultNotOursError when the mount is another account's, and that
 * is final for this key: nothing is started, nothing is written.
 *
 *   recorded owner, same as the key's     → it is ours
 *   recorded owner, different              → refuse
 *   recorded owner, key's owner unknown    → not yet (cannot tell; ask again)
 *   no recorded owner, the Shared Vault    → the key's, recorded only if the
 *                                            folder has never synced (else the
 *                                            daemon decides by what it lists)
 *   no recorded owner                      → ask the API about the vault:
 *     the owner, and it matches the key's  → record it; it is ours
 *     403                                  → refuse (someone else's)
 *     404                                  → refuse (gone)
 *     no answer                            → not yet
 *
 * The Shared Vault is not a row the API can be asked about; it belongs to
 * whoever mounted it, so its owner is the key's, recorded on first contact.
 */
export async function confirmMountAccount(
  v: MountedVault,
  deps: ConfirmMountDeps
): Promise<string | null> {
  // The registry's answer first — this machine's own file, no folder read.
  const recorded =
    v.ownerId ?? readMountedVaults().find((m) => m.vaultId === v.vaultId)?.ownerId ?? null;
  if (recorded) {
    if (deps.keyOwner === null) return null;
    if (recorded !== deps.keyOwner) throw new VaultNotOursError(v.vaultId, recorded, deps.keyOwner, v.name);
    return recorded;
  }
  if (isSharedVault(v.vaultId)) {
    if (deps.keyOwner === null) return null;
    // A folder that already holds shared documents is bound by the daemon,
    // which checks that this key's shared listing names what is in it. A
    // folder that holds nothing yet is whoever mounts it.
    if (!sharedFolderHasDocs(v.dir)) await recordMountOwner(v.vaultId, v.dir, deps.keyOwner);
    return deps.keyOwner;
  }
  // The API before the folder: a 403 or a 404 settles it without reading a
  // byte from a folder that may be another account's. Only a vault the API
  // confirms as this key's is then recorded on disk.
  const whose = await (deps.vaultOwner ?? ((id) => vaultOwnerPerApi(deps.appUrl, deps.apiKey, id)))(v.vaultId);
  if (whose === "not-ours") throw new VaultNotOursError(v.vaultId, null, deps.keyOwner, v.name);
  // Gone, and never recorded as anyone's. Not started: there is nothing to
  // sync it with. The host's own deletion check is what retires the folder.
  if (whose === "deleted") throw new VaultGoneError(v.vaultId, v.name);
  if (whose === null) return null;
  // A 200 means the key's account owns it, so the two can only disagree when
  // /me and /vaults/:id were answered by different accounts — which is to say
  // never, unless the key changed between the two calls. Refuse rather than
  // guess which one to believe.
  if (deps.keyOwner !== null && whose.ownerId !== deps.keyOwner) {
    throw new VaultNotOursError(v.vaultId, whose.ownerId, deps.keyOwner, v.name);
  }
  // Ours per the API: now the folder may be read. A marker that names a
  // different account (the folder was copied from another machine, say) is a
  // disagreement, and a disagreement is refused rather than guessed at.
  const marker = readVaultMarkerInfo(v.dir);
  if (marker && marker.vaultId === v.vaultId && marker.ownerId && marker.ownerId !== whose.ownerId) {
    throw new VaultNotOursError(v.vaultId, marker.ownerId, whose.ownerId, v.name);
  }
  await recordMountOwner(v.vaultId, v.dir, whose.ownerId);
  return whose.ownerId;
}
