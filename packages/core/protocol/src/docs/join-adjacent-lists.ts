import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { canJoin } from "@tiptap/pm/transform";
import type { Node as PMNode } from "@tiptap/pm/model";

// Two lists of the same kind sitting side by side are one list.
//
// Markdown says so: `1. a` `2. b` `1. c` on consecutive lines is a single
// numbered list, and the numbers after the first are ignored. The editor could
// still hold two: lifting an item out of the middle of a list splits it, and
// deleting that lifted item leaves the two halves adjacent — the second one a
// fresh list that starts at 1. So deleting item 3 of four showed "1, 2, 1",
// while the markdown it serialized to (and what every other viewer, and the
// next reload, showed) read 1, 2, 3.
//
// Joining the halves the moment they become adjacent keeps what is on screen
// equal to what is saved. Nothing a user can mean is lost: separate lists in
// markdown need something between them, and then they are not adjacent.

const LIST_TYPES = new Set(["orderedList", "bulletList", "taskList"]);

/** The position between the first pair of adjacent same-kind lists, or null. */
export function adjacentListBoundary(doc: PMNode): number | null {
  let found: number | null = null;
  const visit = (parent: PMNode, base: number): void => {
    let pos = base;
    for (let i = 0; i < parent.childCount && found === null; i++) {
      const child = parent.child(i);
      const next = i + 1 < parent.childCount ? parent.child(i + 1) : null;
      if (next && child.type === next.type && LIST_TYPES.has(child.type.name)) {
        found = pos + child.nodeSize;
        return;
      }
      if (!child.isTextblock && child.childCount > 0) visit(child, pos + 1);
      pos += child.nodeSize;
    }
  };
  visit(doc, 0);
  return found;
}

/** Join every pair of adjacent same-kind lists in `tr`'s document. */
export function joinAdjacentLists(tr: Transaction): boolean {
  let joined = false;
  for (;;) {
    const at = adjacentListBoundary(tr.doc);
    if (at === null || !canJoin(tr.doc, at)) return joined;
    tr.join(at);
    joined = true;
  }
}

export const joinAdjacentListsKey = new PluginKey("joinAdjacentLists");

export const JoinAdjacentLists = Extension.create({
  name: "joinAdjacentLists",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: joinAdjacentListsKey,
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = state.tr;
          return joinAdjacentLists(tr) ? tr : null;
        },
      }),
    ];
  },
});
