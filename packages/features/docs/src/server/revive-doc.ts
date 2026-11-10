import { chooseRevival, getMarkdown, restore } from "@markbase/docs";
import { loadCrdtSnapshot } from "./crdt-store";
import {
  listTrashedInVault,
  restoreDocument,
  setDocumentPath,
  getDocument,
  type DocumentRow,
} from "@markbase/docs/server";

/**
 * Was this file a document we already had?
 *
 * A file can leave and come back without anyone meaning to delete anything — a
 * git branch switch is the ordinary case. Deleting the file deletes the
 * document (the folder is the vault), so without this the file returns as a
 * BRAND NEW document: new id, and the comments, share links and edit history
 * that were attached to the old one do not come with it.
 *
 * This is the I/O half: gather the candidates, read their snapshots, and act on
 * the answer. Which candidate wins is chooseRevival's, and is tested there.
 *
 * The content compared is the CRDT's, not the `content` column: that column is
 * a search mirror, updated on web edits and never by the daemon's pushes, so it
 * is stale for exactly the documents this is meant to find.
 */

/** How far back a returning file may reach. Past this, it is a new document. */
const WINDOW_DAYS = 30;

export interface Revived {
  doc: DocumentRow;
  /** How it was recognised, for the log the daemon writes. */
  by: "content" | "path";
}

export async function reviveForFile(input: {
  vaultId: string;
  path: string;
  content: string;
}): Promise<Revived | null> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await listTrashedInVault(input.vaultId, since);

  const chosen = await chooseRevival(input, candidates, async (id) => {
    const snap = await loadCrdtSnapshot(id).catch(() => null);
    if (!snap) return null;
    const doc = restore(snap.state);
    try {
      return getMarkdown(doc);
    } finally {
      doc.destroy();
    }
  });
  if (!chosen) return null;

  const row = await bring(chosen.id, input.path);
  return row ? { doc: row, by: chosen.by } : null;
}

/** Take a document out of the trash and point it at the file that came back. */
async function bring(id: string, path: string): Promise<DocumentRow | null> {
  await restoreDocument(id);
  // The file may be at a different path than the one it was trashed under — a
  // branch that renamed it as well as removing it. The file on disk is what
  // exists, so it is the path that wins.
  await setDocumentPath(id, path);
  return getDocument(id);
}
