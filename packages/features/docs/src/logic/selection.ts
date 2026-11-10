// Selection preservation across remote edits (roadmap B5).
//
// A remote CRDT update replaces the editor's content, which resets the caret to
// the top — so while you're typing, a collaborator's edit ELSEWHERE yanks your
// cursor away. The fix is to map your selection THROUGH the change: text inserted
// or deleted before you shifts you by that much; a change after you leaves you put.
//
// This file is the pure position math, coordinate-agnostic (offsets into whatever
// flat string the caller uses). The editor wiring captures the caret as a text
// offset, applies the new content, and restores the mapped caret.

/** Length of the shared leading run of two strings. */
function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Length of the shared trailing run, not eating into the already-counted prefix. */
function commonSuffix(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix;
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Map a caret offset in `before` to the equivalent offset in `after`, treating the
 * difference as ONE replaced region (a prefix/suffix diff recovers it — enough for
 * a single remote edit landing between syncs).
 *
 *   • before the change → unchanged
 *   • after the change  → shifted by the length delta
 *   • inside the change → clamped to the replaced region (its text is gone)
 */
export function mapPositionThroughEdit(before: string, after: string, pos: number): number {
  if (before === after) return pos;
  const clamped = Math.max(0, Math.min(pos, before.length));
  const p = commonPrefix(before, after);
  const s = commonSuffix(before, after, p);
  const beforeChangeEnd = before.length - s;
  const afterChangeEnd = after.length - s;
  if (clamped <= p) return clamped; // wholly before the change
  if (clamped >= beforeChangeEnd) return clamped + (after.length - before.length); // wholly after
  // Inside the replaced span: keep the same distance from its start if the new
  // span is long enough, otherwise land at the new span's end.
  return Math.min(clamped, afterChangeEnd);
}

/** Map a whole selection (from ≤ to) through the same edit. */
export function mapSelectionThroughEdit(
  before: string,
  after: string,
  from: number,
  to: number
): { from: number; to: number } {
  return {
    from: mapPositionThroughEdit(before, after, from),
    to: mapPositionThroughEdit(before, after, to),
  };
}
