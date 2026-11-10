import { supabase } from "@markbase/protocol/supabase";
import { createHash } from "node:crypto";
import { selectOrphans, type StoredObject } from "../logic/media";

// Data layer for docs.assets (roadmap A6) — the index that lets a vault-relative
// image path be resolved to bytes.
//
// The markdown says `![d](assets/diagram.png)` and nothing else. This table maps
// (vault, path) → a content-addressed object, so the web can render the path and
// the daemon can write it to disk.
//
// Objects are keyed by the HASH of their bytes, never by the path: the same image
// pasted into five docs stores one object, an object is immutable (so it caches
// forever), and moving an asset is a row update rather than a copy. `path` is
// where a human filed it; `sha256` is what it is.

const db = () => supabase.schema("docs");

export const ASSET_BUCKET = "vault-assets";

/** Signed-URL lifetime. Long enough to render a page, short enough that a leaked
 *  link stops working — the reason this bucket isn't public. */
export const ASSET_URL_TTL_SECONDS = 60 * 60;

export interface AssetRow {
  id: string;
  vault_id: string;
  path: string;
  sha256: string;
  size_bytes: number;
  content_type: string | null;
  owner_id: string;
  created_at: string;
}

/** Hex sha256 of the bytes — the content address, and the storage object key. */
export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Where the bytes live in the bucket. Namespaced by vault so one vault's objects
 * can never be enumerated from another, and content-addressed within it.
 */
export function objectKey(vaultId: string, sha256: string): string {
  return `${vaultId}/${sha256}`;
}

/** Every asset in a vault — what the daemon diffs against the folder on disk. */
export async function listAssets(vaultId: string): Promise<AssetRow[]> {
  const { data, error } = await db()
    .from("assets")
    .select("*")
    .eq("vault_id", vaultId)
    .order("path", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AssetRow[];
}

export async function getAssetByPath(vaultId: string, path: string): Promise<AssetRow | null> {
  const { data, error } = await db()
    .from("assets")
    .select("*")
    .eq("vault_id", vaultId)
    .eq("path", path)
    .maybeSingle();
  if (error) throw error;
  return (data as AssetRow | null) ?? null;
}

/**
 * Store bytes and index them at `path`.
 *
 * Upload first, row second: an object with no row is harmless garbage, while a row
 * with no object is a broken image in someone's document. If the bytes are already
 * there (same hash — the same image pasted twice) the upload is skipped, which is
 * the dedupe falling out of content-addressing rather than being implemented.
 */
export async function putAsset(input: {
  vaultId: string;
  ownerId: string;
  path: string;
  bytes: Uint8Array;
  contentType?: string;
}): Promise<AssetRow> {
  const sha256 = hashBytes(input.bytes);
  const key = objectKey(input.vaultId, sha256);

  const { error: upErr } = await supabase.storage
    .from(ASSET_BUCKET)
    .upload(key, input.bytes, {
      contentType: input.contentType ?? "application/octet-stream",
      // Immutable by construction: this key can only ever hold these bytes.
      upsert: false,
    });
  // A duplicate is success — the bytes we wanted are already there.
  if (upErr && !/exists/i.test(upErr.message)) throw upErr;

  const { data, error } = await db()
    .from("assets")
    .upsert(
      {
        vault_id: input.vaultId,
        path: input.path,
        sha256,
        size_bytes: input.bytes.byteLength,
        content_type: input.contentType ?? null,
        owner_id: input.ownerId,
      },
      { onConflict: "vault_id,path" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as AssetRow;
}

/** A time-limited URL the browser can render. */
export async function signAssetUrl(
  vaultId: string,
  sha256: string,
  ttlSeconds = ASSET_URL_TTL_SECONDS
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(ASSET_BUCKET)
    .createSignedUrl(objectKey(vaultId, sha256), ttlSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Raw bytes — the daemon writing an asset to disk. */
export async function downloadAsset(vaultId: string, sha256: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage
    .from(ASSET_BUCKET)
    .download(objectKey(vaultId, sha256));
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Forget an asset at a path. The object survives if any other path still points at
 * the same bytes — deleting it would blank the image everywhere else it's used,
 * which is exactly the trap content-addressing sets for a careless delete.
 *
 * KNOWN GAP: this is the only path that cleans up an object, and a CASCADE goes
 * around it. Deleting a vault drops its `assets` rows in Postgres, which never
 * tells Storage, so the objects leak. An FK can't help — there's no foreign key
 * from Postgres to a blob store, and Storage refuses direct SQL deletes by design.
 * Every system with an external blob store has this and answers it the same way:
 * a periodic sweep for objects whose row is gone. See `orphanAssetObjects`.
 */
export async function deleteAsset(vaultId: string, path: string): Promise<void> {
  const asset = await getAssetByPath(vaultId, path);
  if (!asset) return;

  const { error } = await db().from("assets").delete().eq("id", asset.id);
  if (error) throw error;

  const { data: others, error: refErr } = await db()
    .from("assets")
    .select("id")
    .eq("vault_id", vaultId)
    .eq("sha256", asset.sha256)
    .limit(1);
  if (refErr) throw refErr;
  if ((others ?? []).length === 0) {
    await supabase.storage.from(ASSET_BUCKET).remove([objectKey(vaultId, asset.sha256)]);
  }
}

/**
 * Object keys in a vault's storage prefix that no `assets` row claims — the leak a
 * cascade leaves behind (see deleteAsset). Returns them rather than deleting, so a
 * caller can log, count, or sweep deliberately: deleting user bytes on the say-so
 * of a query that might have raced an insert is not something to do implicitly.
 */
export async function orphanAssetObjects(
  vaultId: string,
  graceMs = ORPHAN_GRACE_MS,
  now = Date.now()
): Promise<string[]> {
  const { data, error } = await supabase.storage.from(ASSET_BUCKET).list(vaultId, { limit: 1000 });
  if (error || !data) return [];
  const claimed = new Set((await listAssets(vaultId)).map((r) => r.sha256));
  return selectOrphans(data as StoredObject[], claimed, now, graceMs).map(
    (name) => `${vaultId}/${name}`
  );
}

/**
 * How long an object must sit unclaimed before we believe it's abandoned.
 *
 * putAsset uploads bytes and THEN writes the row, so an object legitimately has no
 * row for a moment. Sweeping inside that window would delete the image someone
 * just pasted. A day is far longer than that gap and costs nothing but a little
 * storage.
 */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Sweep every vault's abandoned objects.
 *
 * This has to walk the BUCKET rather than the vaults table, because the worst leak
 * is a DELETED vault: its rows are gone, so there is nothing left in Postgres to
 * enumerate — only a prefix full of bytes nobody will ever ask for again. Each
 * top-level prefix is a vault id, whether or not that vault still exists.
 *
 * Defaults to a DRY RUN. Deleting user bytes is unrecoverable, so the caller says
 * `commit: true` explicitly, and can look first.
 */
export async function sweepOrphanAssets(
  opts: { commit?: boolean; graceMs?: number; now?: number } = {}
): Promise<{ orphans: string[]; removed: number }> {
  const graceMs = opts.graceMs ?? ORPHAN_GRACE_MS;
  const now = opts.now ?? Date.now();

  const { data: prefixes, error } = await supabase.storage
    .from(ASSET_BUCKET)
    .list("", { limit: 1000 });
  if (error || !prefixes) return { orphans: [], removed: 0 };

  const orphans: string[] = [];
  for (const p of prefixes) {
    // A prefix is a vault id. If the vault is gone, listAssets returns nothing and
    // every object under it is an orphan — which is exactly the case we're here for.
    orphans.push(...(await orphanAssetObjects(p.name, graceMs, now)));
  }

  if (!opts.commit || orphans.length === 0) return { orphans, removed: 0 };
  const { error: rmErr } = await supabase.storage.from(ASSET_BUCKET).remove(orphans);
  if (rmErr) throw rmErr;
  return { orphans, removed: orphans.length };
}
