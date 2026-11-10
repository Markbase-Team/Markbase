import { supabase } from "@markbase/protocol/supabase";
import { rebaseToVaultRoot, filesUnder, normalizePath } from "@markbase/protocol/folders";

// Data layer for docs.vaults.
//
// A vault is a named collection of documents that syncs to one local folder —
// Work and Personal can be separate, the way an Obsidian vault is. A document's
// `path` is vault-relative, so the vault is what says which folder it belongs to.
//
// The vault→folder mapping deliberately lives on the device (CLI config /
// Electron settings), not here: a local path is per-machine, and the cloud has no
// business knowing it.

const db = () => supabase.schema("docs");

export interface VaultRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

/** The user's vaults, oldest first — the first is their default. */
export async function listVaultsForUser(userId: string): Promise<VaultRow[]> {
  const { data, error } = await db()
    .from("vaults")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as VaultRow[];
}

export async function getVault(id: string): Promise<VaultRow | null> {
  const { data, error } = await db().from("vaults").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as VaultRow | null) ?? null;
}

/**
 * Does `userId` own vault `vaultId`? A vault that does not exist is not theirs
 * either — the two are deliberately one answer, so a caller probing ids learns
 * nothing about vaults that are not its own.
 *
 * A vault has no members: documents do. So "may write into this vault" means
 * "owns it", and every endpoint that takes a vault_id — creating a document,
 * listing or storing its media — asks this before touching the vault.
 *
 * Incident, 2026-10-30: a desktop app signed into a second account kept the
 * first account's vault folders mounted, listed them under the new key (zero
 * documents, since they were not that account's), read every file as a document
 * that had "left", and POSTed each one back with `adopt: true` and the FIRST
 * account's vault_id. The server took the vault_id on trust and created 116
 * documents owned by the second account inside the first account's vaults.
 */
export async function userOwnsVault(vaultId: string, userId: string): Promise<boolean> {
  const v = await getVault(vaultId);
  return v !== null && v.owner_id === userId;
}

export async function createVault(input: {
  name: string;
  owner_id: string;
}): Promise<VaultRow> {
  const { data, error } = await db()
    .from("vaults")
    .insert({ name: input.name, owner_id: input.owner_id })
    .select("*")
    .single();
  if (error) throw error;
  return data as VaultRow;
}

export async function renameVault(id: string, name: string): Promise<void> {
  const { error } = await db()
    .from("vaults")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Delete a vault and every document in it from the cloud.
 *
 * Ownership is checked here (not just by RLS) so the caller gets a clear "Vault
 * not found" for a bad id or someone else's vault — never a silent no-op that
 * looks like success. Documents go first: a vault row removed while its
 * documents still pointed at it would orphan them into a vault that no longer
 * lists.
 *
 * This is the CLOUD side only. On any machine where the vault is mounted, the
 * desktop/CLI daemon sees it vanish from `GET /api/v1/vaults` and moves the
 * local files into that folder's `.trash/` — the files are never erased from
 * disk here.
 */
export async function deleteVault(id: string, ownerId: string): Promise<void> {
  const vault = await getVault(id);
  if (!vault || vault.owner_id !== ownerId) throw new Error("Vault not found");

  const docs = await db()
    .from("documents")
    .delete()
    .eq("vault_id", id)
    .eq("owner_id", ownerId);
  if (docs.error) throw docs.error;

  const { error } = await db().from("vaults").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
}

/**
 * Turn a folder inside an existing vault into a vault of its own.
 *
 * This is the operation a MOUNT can't do. Mounting points a folder at a vault
 * that already exists; a folder inside a vault isn't a vault yet, so mounting it
 * is refused ("that's a convert"). This is that convert: create the vault, move
 * the documents under the folder into it, and re-base their paths, since a path
 * is vault-relative and the folder is now the root.
 *
 * Atomic — see the plpgsql function. A half-done convert would split the user's
 * documents across two vaults with paths matching neither.
 */
export async function convertFolderToVault(input: {
  ownerId: string;
  fromVaultId: string;
  /** Vault-relative folder to promote, e.g. "projects/2026". */
  folder: string;
  name: string;
}): Promise<{ vault: VaultRow; moved: number }> {
  const folder = normalizePath(input.folder);
  if (folder === "") throw new Error("Cannot convert the vault root into a vault");

  const from = await getVault(input.fromVaultId);
  if (!from || from.owner_id !== input.ownerId) throw new Error("Vault not found");

  // Only documents that actually live under the folder move. Rows with no path
  // yet resolve to a title at the root, so they're not in this folder by
  // definition — they stay put.
  const { data, error } = await db()
    .from("documents")
    .select("id, path")
    .eq("vault_id", input.fromVaultId)
    .eq("owner_id", input.ownerId)
    .not("path", "is", null);
  if (error) throw error;

  const rows = (data ?? []) as Array<{ id: string; path: string }>;
  const byPath = new Map<string, string>();
  for (const r of rows) byPath.set(normalizePath(r.path), r.id);

  const moves = rebaseToVaultRoot(filesUnder([...byPath.keys()], folder), folder);
  const payload = moves.map((m) => ({ id: byPath.get(m.from) as string, path: m.to }));

  const { data: vault, error: rpcError } = await supabase.schema("docs").rpc(
    "convert_folder_to_vault",
    { p_owner: input.ownerId, p_name: input.name.trim(), p_moves: payload }
  );
  if (rpcError) throw rpcError;
  return { vault: vault as VaultRow, moved: payload.length };
}

/**
 * The vault a new document belongs to when the caller doesn't say — the user's
 * oldest vault, created on demand. Every document must land in a vault, or it
 * would sync to no folder at all.
 */
export async function ensureDefaultVault(userId: string): Promise<VaultRow> {
  const existing = await listVaultsForUser(userId);
  if (existing.length > 0) return existing[0];
  return createVault({ name: "My Vault", owner_id: userId });
}
