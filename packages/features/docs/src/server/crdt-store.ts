import { supabase } from "@markbase/protocol/supabase";
import {
  SupabaseDocPubSub,
  base64ToBytes,
  bytesToBase64,
  mergeSnapshot,
  retryingDb,
  type DbResult,
} from "@markbase/docs";

// The server's side of docs.doc_crdt (security lockdown stage 2).
//
// This is the ONLY code that reads or writes the table. It runs with the secret
// key, which bypasses the grants and policies; the question of who may call it
// is answered before it is reached, by requireDocCapability in the handler.
//
// A save MERGES: the incoming state is combined with the stored one and the
// result written with a compare-and-swap on `version`, so two clients saving at
// once both land, and a client whose replica is behind cannot erase what it has
// not yet received. The old upsert could, and that mattered more once the
// daemons started polling for changes instead of hearing every delta live.

const TABLE = "doc_crdt";
const db = () => supabase.schema("docs").from(TABLE);

/** How many lost races a save tolerates before it reports one. */
const SAVE_ATTEMPTS = 6;

interface Row {
  state: string;
  version: number;
}

export interface CrdtSnapshot {
  state: Uint8Array;
  version: number;
}

/** The stored snapshot, or null when the document has none yet. */
export async function loadCrdtSnapshot(docId: string): Promise<CrdtSnapshot | null> {
  const row = await retryingDb(
    `loading the snapshot for ${docId}`,
    () => db().select("state, version").eq("doc_id", docId).maybeSingle<Row>()
  );
  if (!row || !row.state) return null;
  return { state: base64ToBytes(row.state), version: Number(row.version) };
}

export interface CrdtSaveResult {
  version: number;
  /** False when the stored state already held everything `incoming` had. */
  changed: boolean;
  /** What `incoming` added — the broadcast for live peers. Null when nothing. */
  delta: Uint8Array | null;
  /** The merged state now stored. */
  state: Uint8Array;
}

/** A marker a write returns in place of data when its compare-and-swap lost. */
const LOST = Symbol("lost the race");

/**
 * Merge `incoming` into the stored snapshot and persist the result.
 *
 * Throws on bytes that are not a Yjs update (from mergeSnapshot), and on a
 * cloud failure that outlasts the retry policy.
 */
export async function saveCrdtSnapshot(docId: string, incoming: Uint8Array): Promise<CrdtSaveResult> {
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    const existing = await loadCrdtSnapshot(docId);
    const merged = mergeSnapshot(existing?.state ?? null, incoming);
    if (existing && !merged.changed) {
      return { version: existing.version, changed: false, delta: null, state: existing.state };
    }
    const version = (existing?.version ?? 0) + 1;
    const row = {
      state: bytesToBase64(merged.state),
      version,
      updated_at: new Date().toISOString(),
    };
    const outcome = existing
      ? await retryingDb<typeof LOST | null>(`saving the snapshot for ${docId}`, async () => {
          // Zero rows updated means someone else got there first.
          const res = await db()
            .update(row)
            .eq("doc_id", docId)
            .eq("version", existing.version)
            .select("version");
          return { ...res, data: res.error ? null : res.data.length === 0 ? LOST : null };
        })
      : await retryingDb<typeof LOST | null>(`seeding the snapshot for ${docId}`, async () => {
          const res = await db().insert({ doc_id: docId, ...row });
          // 23505: a row appeared since we looked. Not an error — a race.
          if (res.error?.code === "23505") return { data: LOST, error: null, status: res.status };
          return { data: null, error: res.error, status: res.status } as DbResult<typeof LOST | null>;
        });
    if (outcome !== LOST) {
      return { version, changed: true, delta: merged.delta, state: merged.state };
    }
  }
  throw new Error(`saving the snapshot for ${docId}: lost the race ${SAVE_ATTEMPTS} times`);
}

/** One channel set per process; channels are keyed by document inside it. */
let pubsub: SupabaseDocPubSub | null = null;

/**
 * Tell live peers about an update. The server publishes with the secret key
 * over the broadcast endpoint; it joins nothing. Never rejects — publish
 * reports its own failures — and a missed broadcast is reconciled by the next
 * snapshot load.
 */
export function broadcastCrdt(docId: string, update: Uint8Array): Promise<void> {
  if (!pubsub) pubsub = new SupabaseDocPubSub(supabase);
  return pubsub.publish(docId, update);
}

export interface CrdtChange {
  doc_id: string;
  version: number;
}

export interface CrdtChanges {
  /** Hand this back as `since` next time. */
  cursor: string;
  changes: CrdtChange[];
}

/**
 * The poll window reaches back this far behind the cursor. A row's
 * `updated_at` is stamped before its write commits, so a poll that ran in
 * between would otherwise step past it. Pollers dedupe by version, so a row
 * reported twice costs nothing.
 */
const CHANGES_OVERLAP_MS = 2_000;

/**
 * Which documents the feed covers — the two folders a daemon can hold.
 * `{ vaultId }` is one of the user's own vaults (a document shared with them
 * lives in its owner's vault, so it is not there); `"shared"` is their Shared
 * Vault: documents they are a member of but do not own. Nothing: both, which is
 * what the desktop window shows.
 */
export type CrdtChangesScope = { vaultId?: string } | "shared";

/**
 * Snapshots newer than `since` among the documents `userId` can see, within
 * `scope`.
 *
 * No `since` establishes the cursor and reports nothing: the caller has not
 * loaded anything yet, so there is nothing it could be behind on.
 */
export async function listCrdtChanges(
  userId: string,
  since: string | null,
  scope: CrdtChangesScope = {}
): Promise<CrdtChanges> {
  if (!since) return { cursor: new Date().toISOString(), changes: [] };
  const from = new Date(since);
  if (Number.isNaN(from.getTime())) throw new Error("since must be an ISO timestamp");
  const rows = await retryingDb(
    "listing changed snapshots",
    () =>
      supabase.schema("docs").rpc("crdt_changes", {
        p_user: userId,
        p_since: new Date(from.getTime() - CHANGES_OVERLAP_MS).toISOString(),
        p_vault: scope === "shared" ? null : (scope.vaultId ?? null),
        p_shared: scope === "shared",
      }) as unknown as PromiseLike<
        DbResult<Array<{ doc_id: string; version: number; updated_at: string }>>
      >
  );
  const list = rows ?? [];
  const cursor = list.length ? list[list.length - 1].updated_at : since;
  return {
    cursor,
    changes: list.map((r) => ({ doc_id: r.doc_id, version: Number(r.version) })),
  };
}
