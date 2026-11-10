// Keeping a running vault in step with the cloud (roadmap F1, D).
//
// The daemon resolved every document's path ONCE, at startup. A move made on the
// web — or a convert, which re-bases a whole folder's paths into another vault —
// was therefore invisible until someone restarted it, and until then the daemon
// kept writing each doc at its stale path. Restart, and the files existed in two
// places: the strays got adopted as brand-new documents.
//
// So the running daemon asks the cloud what it says now, and diffs. Identity is
// the document ID — never the path. A doc that moved is the same doc; matching on
// path would read it as a delete plus a create, losing its CRDT and duplicating
// the file, which is the exact bug this exists to prevent.

/**
 * A document the daemon syncs: its cloud id and the vault-relative path it lives
 * at.
 *
 * Defined here rather than in the sync engine because it is a document's
 * identity, not a property of how it is synced — and because the alternative
 * pointed this package at @markbase/vault, which would make the isomorphic half
 * depend on the node half. The type is erased at compile time, so that edge cost
 * nothing at runtime; it still read as a cycle to anyone following the graph.
 */
export interface VaultDocRef {
  id: string;
  path: string;
  /**
   * The document row's markdown, used only if the cloud has no CRDT for it yet.
   * A doc created through the API keeps its content in the row until something
   * opens it; without this we'd materialize an empty file and push the emptiness
   * up as its CRDT. See VaultSync.open.
   */
  seed?: string;
  /**
   * The user may read this document but not write it (a viewer or a commenter
   * of a shared document — see docs/shared-vault.md). The daemon writes its
   * file read-only and never saves its replica. Absent means writable.
   */
  readOnly?: boolean;
}

/** What the daemon must do to agree with the cloud again. */
export interface ReconcilePlan {
  /** Documents we don't have yet (created on another device). */
  open: VaultDocRef[];
  /** Documents whose path changed in the cloud (a web drag, a rename). */
  move: Array<{ id: string; from: string; to: string }>;
  /** Documents that left our vault — deleted, or converted into another one. */
  close: VaultDocRef[];
}

/**
 * Diff what we hold against what the cloud says.
 *
 * `closableIds` guards the in-flight adoption race: a poll's reply is a snapshot
 * from before the request, so a file adopted while it was in flight is
 * legitimately absent from it. Closing on that basis would retire a document the
 * user just created — data loss caused purely by timing. Pass the ids known
 * BEFORE the fetch began and only those can be closed; anything newer is left
 * alone until a later poll can speak to it. Omit it and every absence closes.
 */
export function planReconcile(
  current: VaultDocRef[],
  desired: VaultDocRef[],
  closableIds?: ReadonlySet<string>
): ReconcilePlan {
  const held = new Map(current.map((c) => [c.id, c]));
  const wanted = new Map(desired.map((d) => [d.id, d]));

  const open: VaultDocRef[] = [];
  const move: ReconcilePlan["move"] = [];
  for (const d of desired) {
    const mine = held.get(d.id);
    if (!mine) open.push(d);
    else if (mine.path !== d.path) move.push({ id: d.id, from: mine.path, to: d.path });
  }

  const close = current.filter(
    (c) => !wanted.has(c.id) && (closableIds === undefined || closableIds.has(c.id))
  );

  return { open, move, close };
}
