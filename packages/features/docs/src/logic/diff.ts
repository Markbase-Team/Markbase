import { diffWords } from "diff";

// Semantic (word-level) diff of the markdown before vs after a save. Used to
// summarize a revision as "+N -M words" instead of counting keystrokes, and to
// render an inline diff. Word granularity keeps it meaningful to a human.

export type DiffSegment = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Words added and removed between two markdown strings. */
export function diffCounts(
  before: string,
  after: string
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const part of diffWords(before, after)) {
    if (part.added) added += countWords(part.value);
    else if (part.removed) removed += countWords(part.value);
  }
  return { added, removed };
}

/** The full word-diff as ordered segments, for inline rendering. */
export function diffSegments(before: string, after: string): DiffSegment[] {
  return diffWords(before, after).map((p) => ({
    value: p.value,
    added: p.added,
    removed: p.removed,
  }));
}
