import { supabase } from "@markbase/protocol/supabase";
import { emptyDoc } from "../logic/markdown";
import { collapseToPrimary } from "../logic/tab-group";
import type { DocJSON } from "../logic/types";
import type { Capability } from "./auth";
import { listMembershipsForUser } from "./members";

// Data layer for docs.documents. All access goes through the `docs` schema
// (supabase.schema("docs")) — remember to add `docs` to the API's Exposed
// Schemas in the Supabase dashboard, or these calls 404.

const db = () => supabase.schema("docs");

export interface DocumentRow {
  id: string;
  title: string;
  doc_json: DocJSON;
  base_doc: DocJSON;
  content: string;
  version: number;
  owner_id: string;
  // A "logical document" is a group of tabs sharing tab_group_id; each tab is a
  // full document row. `position` orders the tabs in the group.
  tab_group_id: string;
  position: number;
  created_at: string;
  updated_at: string;
  // Publish-to-web: stable public slug + when it was last published (null = not
  // published). The public page at /p/<public_slug> renders only when published.
  public_slug: string | null;
  published_at: string | null;
  // Vault-relative path ("projects/2026/q1.md"). The vault's folder structure
  // lives in this path; null for documents created before paths existed, which
  // fall back to a sanitized title at the vault root.
  path: string | null;
  // Which vault this document lives in — `path` is relative to it. A document
  // without one syncs to no folder, so the API always resolves a default.
  vault_id: string | null;
}

export type TabRow = { id: string; title: string; position: number };

/**
 * A row as the LIST endpoints return it — everything a listing needs and none of
 * the document bodies. `doc_json`/`base_doc`/`content` are the bulk of a row
 * (the CRDT snapshot of every doc); selecting them for a list of 50 docs pulls
 * megabytes over the wire to then throw away, which is what made the docs
 * sidebar sit on "Loading…" for seconds. `content` comes back only when a caller
 * asks for it (the vault daemon does, to seed a doc the cloud has no CRDT for).
 */
export type DocumentListRow = Pick<
  DocumentRow,
  | "id"
  | "title"
  | "version"
  | "owner_id"
  | "tab_group_id"
  | "position"
  | "created_at"
  | "updated_at"
  | "path"
  | "vault_id"
> & { content?: string };

const LIST_COLUMNS =
  "id,title,version,owner_id,tab_group_id,position,created_at,updated_at,path,vault_id";
const listColumns = (withContent: boolean) =>
  withContent ? `${LIST_COLUMNS},content` : LIST_COLUMNS;

export async function createDocument(input: {
  title?: string;
  doc_json: DocJSON;
  content: string;
  owner_id: string;
  /** Where this doc lives in the vault; omit for a root-level doc. */
  path?: string | null;
  /** Which vault it belongs to. The API resolves the user's default when absent. */
  vault_id?: string | null;
}): Promise<DocumentRow> {
  const { data, error } = await db()
    .from("documents")
    .insert({
      title: input.title ?? "Untitled",
      doc_json: input.doc_json,
      base_doc: input.doc_json, // immutable v0 snapshot for reconstruction
      content: input.content,
      owner_id: input.owner_id,
      path: input.path ?? null,
      vault_id: input.vault_id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DocumentRow;
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  // Trashed reads as absent — see getTrashedDocument for the restore path.
  const { data, error } = await db()
    .from("documents")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as DocumentRow | null) ?? null;
}

/** A trashed document, for the restore path only. Null if it is live or absent. */
export async function getTrashedDocument(id: string): Promise<DocumentRow | null> {
  const { data, error } = await db()
    .from("documents")
    .select("*")
    .eq("id", id)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (error) throw error;
  return (data as DocumentRow | null) ?? null;
}

/** The tabs of a logical document (same tab_group_id), ordered left→right. */
export async function listTabs(tabGroupId: string): Promise<TabRow[]> {
  const { data, error } = await db()
    .from("documents")
    .select("id, title, position")
    .eq("tab_group_id", tabGroupId)
    .is("deleted_at", null)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data ?? []) as TabRow[];
}

/** Add a new (empty) tab to the same group as `sourceDocId`, placed after the
 *  existing ones. Never before: listings represent a group by its primary tab
 *  (see logic/tab-group), and a new empty tab must not become the document. */
export async function createTab(sourceDocId: string): Promise<DocumentRow> {
  const source = await getDocument(sourceDocId);
  if (!source) throw new Error("Document not found");
  const tabs = await listTabs(source.tab_group_id);
  const position = tabs.reduce((m, t) => Math.max(m, t.position), -1) + 1;
  const seed = emptyDoc().toJSON() as DocJSON;
  const { data, error } = await db()
    .from("documents")
    .insert({
      title: "New tab",
      doc_json: seed,
      base_doc: seed,
      content: "",
      owner_id: source.owner_id,
      // Tabs of one logical document must live in the same vault as their
      // siblings, or the document would straddle two folders.
      vault_id: source.vault_id,
      tab_group_id: source.tab_group_id,
      position,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DocumentRow;
}

/** Reorder the tabs of a group: set each tab's position to its index in
 *  `orderedIds`. Every id must belong to `tabGroupId` (the eq guard drops any
 *  that don't), so a caller can only reshuffle tabs within one document. */
export async function reorderTabs(
  tabGroupId: string,
  orderedIds: string[]
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, i) =>
      db()
        .from("documents")
        .update({ position: i })
        .eq("id", id)
        .eq("tab_group_id", tabGroupId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/** Docs the user can see: ones they own, plus ones they're a member of.
 *  Collapsed to one row per tab group (its primary tab). */
export async function listDocumentsForUser(
  userId: string,
  /** Restrict to one vault. Shared-with-me docs live in their OWNER's vault, so
   *  scoping to your vault deliberately leaves them out. */
  vaultId?: string,
  /** Include each doc's markdown. Only the vault daemon needs it. */
  withContent = false
): Promise<DocumentListRow[]> {
  const cols = listColumns(withContent);
  // Scope in SQL, not after the fact: a vault-scoped list has no reason to pull
  // every other vault's rows across the wire first.
  const ownedQuery = db()
    .from("documents")
    .select(cols)
    .eq("owner_id", userId)
    .is("deleted_at", null);
  if (vaultId) ownedQuery.eq("vault_id", vaultId);

  // Independent queries — run them together rather than one after the other.
  const [owned, memberRows] = await Promise.all([
    ownedQuery,
    db().from("members").select("doc_id").eq("user_id", userId),
  ]);
  if (owned.error) throw owned.error;
  if (memberRows.error) throw memberRows.error;

  const memberIds = (memberRows.data ?? []).map((r) => r.doc_id as string);
  let shared: DocumentListRow[] = [];
  if (memberIds.length) {
    const sharedQuery = db()
      .from("documents")
      .select(cols)
      .in("id", memberIds)
      .is("deleted_at", null);
    if (vaultId) sharedQuery.eq("vault_id", vaultId);
    const res = await sharedQuery;
    if (res.error) throw res.error;
    shared = (res.data ?? []) as unknown as DocumentListRow[];
  }

  const byId = new Map<string, DocumentListRow>();
  for (const d of [...((owned.data ?? []) as unknown as DocumentListRow[]), ...shared]) {
    byId.set(d.id, d);
  }
  // One entry per logical document. A document's tabs all share its vault, so
  // the vault scoping above can never split a group.
  return collapseToPrimary(byId.values()).sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at)
  );
}

/**
 * A shared document as the member sees it: the row, plus what the member holds
 * on it. `capability` and `member_path` come off their docs.members row;
 * `has_crdt` says whether anything has opened the document yet — a viewer's
 * daemon cannot seed a CRDT (it may not write), so until one exists it has
 * nothing it can safely mirror.
 */
export type SharedDocumentListRow = DocumentListRow & {
  capability: Capability;
  /** The member's own path in their Shared Vault; null = the default layout. */
  member_path: string | null;
  has_crdt: boolean;
};

/**
 * Docs shared WITH the user — ones they're a member of but don't own. These live
 * in their owner's vault, so a vault-scoped list never surfaces them; the
 * "Shared with me" view and the Shared Vault daemon are the places they appear.
 * Collapsed to one row per tab group, newest first.
 */
export async function listSharedDocumentsForUser(
  userId: string,
  /** Include each doc's markdown. Only the vault daemon needs it. */
  withContent = false
): Promise<SharedDocumentListRow[]> {
  const memberships = await listMembershipsForUser(userId);
  if (memberships.length === 0) return [];
  const byDoc = new Map(memberships.map((m) => [m.docId, m]));
  const memberIds = [...byDoc.keys()];

  // Independent queries — run them together rather than one after the other.
  const [res, crdt] = await Promise.all([
    db().from("documents").select(listColumns(withContent)).in("id", memberIds).is("deleted_at", null),
    db().from("doc_crdt").select("doc_id").in("doc_id", memberIds),
  ]);
  if (res.error) throw res.error;
  if (crdt.error) throw crdt.error;
  const hasCrdt = new Set((crdt.data ?? []).map((r) => r.doc_id as string));

  // A doc you own isn't "shared with you" even if a membership row exists.
  const rows = ((res.data ?? []) as unknown as DocumentListRow[]).filter(
    (d) => d.owner_id !== userId
  );
  return collapseToPrimary(rows)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((d) => {
      const m = byDoc.get(d.id);
      return {
        ...d,
        // Collapsed to the primary tab, whose membership row is the one the
        // share created; a tab with no row of its own inherits it.
        capability: m?.capability ?? "viewer",
        member_path: m?.path ?? null,
        has_crdt: hasCrdt.has(d.id),
      };
    });
}

export type DocSearchHit = {
  id: string;
  title: string;
  path: string | null;
  vault_id: string | null;
  /** A short excerpt of the content around the match (or the start of the doc). */
  snippet: string;
  updated_at: string;
};

/** ~120 chars of `content` centred on the first occurrence of `needle`. */
function makeSnippet(content: string, needle: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return text.slice(0, 120) + (text.length > 120 ? "…" : "");
  const start = Math.max(0, i - 40);
  const end = Math.min(text.length, i + needle.length + 80);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

/**
 * Full-text-ish search over the caller's documents — title + markdown content,
 * case-insensitive. Scoped like the sidebar it feeds: one vault (owned docs), or
 * shared-with-me. Collapsed to one hit per logical document, newest first.
 */
export async function searchDocuments(
  userId: string,
  opts: { query: string; vaultId?: string; shared?: boolean }
): Promise<DocSearchHit[]> {
  const raw = opts.query.trim();
  // PostgREST's or-filter is delimited by , ( ) and uses * as its wildcard, so a
  // query containing them would corrupt the filter — neutralise them.
  const needle = raw.replace(/[,()*\\%]/g, " ").replace(/\s+/g, " ").trim();
  if (!needle) return [];
  const pattern = `*${needle}*`;

  let sel = db()
    .from("documents")
    .select(
      "id,title,path,vault_id,content,owner_id,tab_group_id,position,created_at,updated_at"
    );

  if (opts.shared) {
    const memberRows = await db().from("members").select("doc_id").eq("user_id", userId);
    if (memberRows.error) throw memberRows.error;
    const ids = (memberRows.data ?? []).map((r) => r.doc_id as string);
    if (ids.length === 0) return [];
    sel = sel.in("id", ids);
  } else {
    sel = sel.eq("owner_id", userId);
    if (opts.vaultId) sel = sel.eq("vault_id", opts.vaultId);
  }

  const { data, error } = await sel
    .is("deleted_at", null) // a trashed document is not a search result
    .or(`title.ilike.${pattern},content.ilike.${pattern}`)
    .order("updated_at", { ascending: false })
    .limit(80);
  if (error) throw error;

  type Row = Pick<
    DocumentRow,
    | "id"
    | "title"
    | "path"
    | "vault_id"
    | "content"
    | "owner_id"
    | "tab_group_id"
    | "position"
    | "created_at"
    | "updated_at"
  >;
  // A doc you own isn't "shared with you", even if a membership row exists.
  const rows = ((data ?? []) as Row[]).filter((d) => !(opts.shared && d.owner_id === userId));

  const lower = needle.toLowerCase();
  return collapseToPrimary(rows)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 30)
    .map((d) => ({
      id: d.id,
      title: d.title,
      path: d.path,
      vault_id: d.vault_id,
      updated_at: d.updated_at,
      snippet: makeSnippet(d.content ?? "", lower),
    }));
}

export async function renameDocument(
  id: string,
  title: string
): Promise<void> {
  const { error } = await db()
    .from("documents")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * The vault path a document should have for `title`, keeping its current folder.
 * The file on disk is written at this path, so renaming the title renames the
 * file (path-follows-title). Filesystem-unsafe characters become "-"; the folder
 * is preserved so a rename never yanks the doc out of its subfolder.
 */
export function pathFollowingTitle(currentPath: string | null, title: string): string {
  const stem = title.replace(/[/\\:*?"<>|]+/g, "-").trim() || "untitled";
  const slash = currentPath ? currentPath.lastIndexOf("/") : -1;
  const folder = slash > 0 ? currentPath!.slice(0, slash) : "";
  return folder ? `${folder}/${stem}.md` : `${stem}.md`;
}

/**
 * Move a document within the vault. The path carries the folder structure, so
 * this is what a folder rename/move ultimately writes — without it, a move made
 * on disk is re-keyed only in memory and the next sync pulls the file back to
 * its old path. `null` puts the doc back at the vault root.
 */
export async function setDocumentPath(id: string, path: string | null): Promise<void> {
  const { error } = await db()
    .from("documents")
    .update({ path, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Keep the Postgres row in step with a CRDT content edit. The CRDT Y.Doc is the
 * truth now; `documents.content`/`doc_json` are a searchable mirror that full-text
 * search (`searchDocuments`) and the document list read. Bumps `updated_at` so an
 * agent edit rises to the top of the list, like a human edit would.
 */
export async function mirrorDocContent(
  docId: string,
  content: string,
  docJson: DocJSON
): Promise<void> {
  const { error } = await db()
    .from("documents")
    .update({ content, doc_json: docJson, updated_at: new Date().toISOString() })
    .eq("id", docId);
  if (error) throw error;
}

/**
 * Move a document to trash. Reversible — see restoreDocument.
 *
 * NOT a row delete: doc_crdt references documents ON DELETE CASCADE, so removing
 * the row destroys the CRDT, and the CRDT is the text, the comments and the whole
 * version history. Every read filters trashed rows out, so the document behaves
 * as gone without being gone.
 */
export async function deleteDocument(id: string): Promise<void> {
  const { error } = await db()
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null); // already trashed: leave the original timestamp
  if (error) throw error;
}

/**
 * Recently trashed documents in a vault — the candidates a returning file could
 * be. Ordered newest first, and capped, because this runs when a file appears
 * and a file appearing must stay cheap.
 */
export async function listTrashedInVault(
  vaultId: string,
  since: Date,
  limit = 40
): Promise<Array<{ id: string; path: string | null; deleted_at: string }>> {
  const { data, error } = await db()
    .from("documents")
    .select("id,path,deleted_at")
    .eq("vault_id", vaultId)
    .not("deleted_at", "is", null)
    .gte("deleted_at", since.toISOString())
    .order("deleted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; path: string | null; deleted_at: string }>;
}

/** Bring a trashed document back. */
export async function restoreDocument(id: string): Promise<void> {
  const { error } = await db()
    .from("documents")
    .update({ deleted_at: null })
    .eq("id", id);
  if (error) throw error;
}

/** Delete a whole logical document — every tab in `id`'s group. */
export async function deleteDocumentGroup(id: string): Promise<void> {
  const doc = await getDocument(id);
  if (!doc) return;
  const { error } = await db()
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("tab_group_id", doc.tab_group_id)
    .is("deleted_at", null);
  if (error) throw error;
}
