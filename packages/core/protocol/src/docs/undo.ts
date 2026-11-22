// Undo/redo for the local editor, scoped so it never reverts other people's work.
//
// A Y.UndoManager over the markdown source Y.Text. It only tracks transactions
// whose origin is in `trackedOrigins` (e.g. "editor"), so undo walks back the
// local user's own edits and leaves remote/cloud edits and file-intake edits
// untouched — even when they're interleaved, because the CRDT lets us undo one
// author's changes selectively.

import * as Y from "yjs";
import type { Origin } from "./crdt";

const SOURCE_KEY = "source";

/**
 * Create an undo manager for a doc's markdown source.
 *
 * @param trackedOrigins only edits made under these transaction origins are
 *   undoable (pass the origin your editor uses, e.g. "editor").
 * @param captureTimeout edits closer than this (ms) merge into one undo step;
 *   call `stopCapturing()` to force a boundary.
 */
export function createUndoManager(
  doc: Y.Doc,
  trackedOrigins: Origin[],
  captureTimeout = 500
): Y.UndoManager {
  return new Y.UndoManager(doc.getText(SOURCE_KEY), {
    trackedOrigins: new Set<Origin>(trackedOrigins),
    captureTimeout,
  });
}
