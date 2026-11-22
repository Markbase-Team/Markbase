/**
 * Which trashed document, if any, is the file that just came back.
 *
 * A file can leave and return without anyone meaning to delete anything — a git
 * branch switch is the ordinary case. Deleting a file deletes its document (the
 * folder is the vault), so unless the returning file is recognised it comes back
 * as a BRAND NEW document, and the comments, share links and edit history that
 * hung off the old id stay behind on it.
 *
 * The decision is here, away from the database and the snapshot store, because
 * the decision is the part with judgement in it: content decides, the path is a
 * guarded fallback, and reading a snapshot costs a round trip so the order in
 * which candidates are tried is part of the design rather than an accident.
 */

export interface RevivalCandidate {
  id: string;
  /** The path it was trashed under; null for documents older than paths. */
  path: string | null;
}

export interface Revival {
  id: string;
  /** Content is proof; path is an inference. Callers log which it was. */
  by: "content" | "path";
}

/**
 * @param contentOf reads a candidate's current markdown (its CRDT, not the
 *   `content` column — that column is a search mirror the daemon never updates,
 *   so it is stale for exactly the documents this looks for). Returning null
 *   means "cannot tell", and the candidate is skipped rather than assumed.
 * @param maxReads how many candidates may be opened before giving up. A file
 *   appearing has to stay cheap: a branch switch restores them in bulk.
 */
export async function chooseRevival(
  file: { path: string; content: string },
  candidates: RevivalCandidate[],
  contentOf: (id: string) => Promise<string | null>,
  maxReads = 12
): Promise<Revival | null> {
  if (candidates.length === 0) return null;

  // Same path first. Not because the path decides — it does not — but because
  // it is the likeliest to be the one whose content matches, and every read
  // costs a round trip. Ordering is an optimisation; the answer is the same
  // either way.
  const ordered = [
    ...candidates.filter((c) => c.path === file.path),
    ...candidates.filter((c) => c.path !== file.path),
  ];

  const wanted = file.content.trim();
  let reads = 0;
  for (const c of ordered) {
    if (reads >= maxReads) break;
    reads += 1;
    const content = await contentOf(c.id);
    if (content === null) continue;
    if (content.trim() === wanted) return { id: c.id, by: "content" };
  }

  // Nothing matched. A document trashed at this very path is still probably
  // this file — a branch that edited it as well as moving it — but "probably"
  // is why this is second, and why the caller only offers candidates from a
  // recent window: the `todo.md` deleted in January is not the one written in
  // March, and inheriting January's comments would be worse than a new document.
  const samePath = ordered.find((c) => c.path === file.path);
  return samePath ? { id: samePath.id, by: "path" } : null;
}
