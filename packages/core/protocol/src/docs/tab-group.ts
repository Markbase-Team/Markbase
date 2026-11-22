// Which tab stands for a logical document. A document is a group of tabs
// (rows sharing `tab_group_id`), and every listing — the sidebar, search, the
// vault daemon's mirror — shows one row per group. That row's id is the
// document's identity everywhere outside the tab strip: it is the URL, the
// sidebar entry, and the file the daemon writes to disk.
//
// It used to be the lowest-position tab, and new tabs were inserted at the
// lowest position — so pressing "+" silently made an empty tab the document.
// The daemon then saw the real tab vanish from the listing, trashed its file,
// and wrote the empty tab as a 0-byte one. Position is for ordering the strip;
// identity has to be something a reorder or an added tab can't move, and the
// tab the document was created with is that.

export interface TabIdentity {
  tab_group_id: string;
  position: number;
  created_at: string;
}

/** The one of two sibling tabs that stands for their document: the earlier
 *  created; among equals the lower position, then the smaller id, so the
 *  choice is stable whatever order the rows arrive in. */
export function primaryOf<T extends TabIdentity & { id: string }>(a: T, b: T): T {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? a : b;
  if (a.position !== b.position) return a.position < b.position ? a : b;
  return a.id <= b.id ? a : b;
}

/** One row per logical document, each group represented by its primary tab. */
export function collapseToPrimary<T extends TabIdentity & { id: string }>(rows: Iterable<T>): T[] {
  const byGroup = new Map<string, T>();
  for (const row of rows) {
    const held = byGroup.get(row.tab_group_id);
    byGroup.set(row.tab_group_id, held ? primaryOf(held, row) : row);
  }
  return [...byGroup.values()];
}
