"use client";

// The vault folder's own index, read from disk through the host's vaults port.
//
// A mounted vault already holds every document as a file, and (since the daemon
// started writing .markbase/index.json) knows which document each file is. That
// is the same list `/api/v1/docs?vault=…` returns, minus the round trip — so on
// the desktop the tree can render from it immediately and let the network answer
// arrive whenever it does.
//
// It is a CACHE. The server stays the authority: we show the index, then replace
// it with the real list. Anything the index knows and the server doesn't (a doc
// deleted elsewhere since the daemon last ran) survives only until that answer
// lands, and nothing is deleted on the index's say-so.
//
// Absent in a browser, and for a vault this machine hasn't mounted — both just
// mean the caller waits for the API, exactly as before.

import type { CrdtPort, VaultIndexEntry, VaultsPort } from "./ports";

export type { VaultIndexEntry } from "./ports";

/**
 * The documents this machine already has for `vaultId`, or null when it can't
 * say — no vaults port (a browser), vault not mounted here, or never synced.
 */
export async function readLocalVaultDocs(
  vaults: VaultsPort | null,
  vaultId: string
): Promise<VaultIndexEntry[] | null> {
  if (!vaults) return null;
  try {
    const index = await vaults.index(vaultId);
    return index?.docs?.length ? index.docs : null;
  } catch {
    return null; // a broken index is not an error — ask the network
  }
}

/**
 * Everything this machine knows about a document without asking anyone: its
 * place in the vault, and whether its content is already here.
 *
 * Null unless BOTH are true — the index names it and the snapshot is on disk.
 * Without the snapshot there is nothing to show, and worse, opening the editor
 * would let it seed an empty CRDT over a document whose content lives in its row.
 */
export async function readLocalDoc(
  ports: { vaults: VaultsPort | null; crdt: CrdtPort | null },
  vaultId: string,
  docId: string
): Promise<VaultIndexEntry | null> {
  if (!ports.crdt) return null;
  const docs = await readLocalVaultDocs(ports.vaults, vaultId);
  const entry = docs?.find((d) => d.id === docId);
  if (!entry) return null;
  try {
    return (await ports.crdt.has(docId)) ? entry : null;
  } catch {
    return null;
  }
}

/** Which document a file in the vault holds, per the local index. */
export async function localDocIdForFile(
  vaults: VaultsPort | null,
  vaultId: string,
  file: string
): Promise<string | null> {
  const docs = await readLocalVaultDocs(vaults, vaultId);
  if (!docs) return null;
  const want = file.replace(/\\/g, "/").replace(/^\.\//, "");
  return docs.find((d) => d.file === want)?.id ?? null;
}
