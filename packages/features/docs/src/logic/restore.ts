import { Node, Slice } from "prosemirror-model";
import { ReplaceStep } from "prosemirror-transform";
import { docSchema } from "./schema";
import type { DocJSON, StepJSON } from "./types";

// Steps that turn the CURRENT document into the target one — used by markdown-mode
// saves (POST /content) and by restore. Rather than replacing the whole body
// (which stores the entire document as one step and clobbers unchanged regions),
// compute the MINIMAL changed span with ProseMirror's findDiffStart/findDiffEnd
// and emit a single ReplaceStep over just that range — the same surgical edit a
// human's transaction would produce.
export function docReplaceSteps(
  currentJson: DocJSON,
  targetJson: DocJSON
): StepJSON[] {
  const current = Node.fromJSON(docSchema, currentJson);
  const target = Node.fromJSON(docSchema, targetJson);

  const start = current.content.findDiffStart(target.content);
  if (start === null) return []; // identical — no change, no version bump

  const end = current.content.findDiffEnd(target.content);
  if (end === null) {
    // Differ at the start but not the end shouldn't happen; replace all to be safe.
    const step = new ReplaceStep(
      0,
      current.content.size,
      new Slice(target.content, 0, 0)
    );
    return [step.toJSON() as StepJSON];
  }

  // `end.a` / `end.b` are where current/target stop differing, scanning from the
  // end. On small edits the prefix and suffix can overlap — nudge the ends so the
  // replaced range stays valid.
  let endCurrent = end.a;
  let endTarget = end.b;
  const overlap = start - Math.min(endCurrent, endTarget);
  if (overlap > 0) {
    endCurrent += overlap;
    endTarget += overlap;
  }

  const step = new ReplaceStep(
    start,
    endCurrent,
    target.slice(start, endTarget)
  );
  return [step.toJSON() as StepJSON];
}
