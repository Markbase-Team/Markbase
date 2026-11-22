import { diffChars } from "diff";

// Which characters changed between two versions of a file — what the write
// audit records for every agent write (agent-audit.ts).
//
// Offsets count UTF-16 code units from the start of the text, the same
// indices a JavaScript string uses, so `before.slice(oldStart, oldStart +
// removed.length)` is exactly the removed text and `after.slice(newStart,
// newStart + inserted.length)` exactly the inserted.

/** One run of characters replaced by another; either side may be empty. */
export interface TextChange {
  /** Where the removed text began in the text BEFORE the write. */
  oldStart: number;
  /** Where the inserted text begins in the text AFTER the write. */
  newStart: number;
  removed: string;
  inserted: string;
}

/**
 * Past this many characters on both sides of the changed middle, the precise
 * diff is skipped and the middle is recorded as one replacement. A character
 * diff costs time in proportion to how much differs, a hook has seconds, and
 * a file rewritten wholesale has no finer truth to find anyway.
 */
const PRECISE_LIMIT = 20_000;

/** The changes that turn `before` into `after`, in order; empty when they are equal. */
export function textChanges(before: string, after: string): TextChange[] {
  if (before === after) return [];

  // Most writes touch a small part of a file. Strip what is common at both
  // ends first, so the diff only ever sees the part that differs.
  let head = 0;
  const shortest = Math.min(before.length, after.length);
  while (head < shortest && before.charCodeAt(head) === after.charCodeAt(head)) head++;
  let tail = 0;
  while (
    tail < shortest - head &&
    before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)
  ) {
    tail++;
  }
  const oldMiddle = before.slice(head, before.length - tail);
  const newMiddle = after.slice(head, after.length - tail);

  if (oldMiddle.length === 0 || newMiddle.length === 0 || Math.min(oldMiddle.length, newMiddle.length) > PRECISE_LIMIT) {
    return [{ oldStart: head, newStart: head, removed: oldMiddle, inserted: newMiddle }];
  }

  const changes: TextChange[] = [];
  let oldAt = head;
  let newAt = head;
  let open: TextChange | null = null;
  for (const part of diffChars(oldMiddle, newMiddle)) {
    if (!part.added && !part.removed) {
      open = null;
      oldAt += part.value.length;
      newAt += part.value.length;
      continue;
    }
    // A removal and the insertion that replaces it arrive as two parts: one change.
    if (!open) {
      open = { oldStart: oldAt, newStart: newAt, removed: "", inserted: "" };
      changes.push(open);
    }
    if (part.removed) {
      open.removed += part.value;
      oldAt += part.value.length;
    } else {
      open.inserted += part.value;
      newAt += part.value.length;
    }
  }
  return changes;
}

/** How many characters a set of changes inserted and removed. */
export function changeTotals(changes: TextChange[]): { inserted: number; removed: number } {
  let inserted = 0;
  let removed = 0;
  for (const c of changes) {
    inserted += c.inserted.length;
    removed += c.removed.length;
  }
  return { inserted, removed };
}
