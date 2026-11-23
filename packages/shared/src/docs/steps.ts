import { Node } from "prosemirror-model";
import { Step } from "prosemirror-transform";
import { docSchema } from "./schema";
import type { DocJSON, StepJSON } from "./types";

// The transform core. Pure, headless (no DOM) — runs the same in the browser
// and on the server. The edit API (the collab authority) calls applySteps to
// advance the canonical document; mapPositionThroughSteps moves a stored
// position (a comment anchor, a selection) forward across later edits.

/** Apply an ordered list of steps to a document, returning the new doc JSON. */
export function applySteps(docJson: DocJSON, steps: StepJSON[]): DocJSON {
  let doc = Node.fromJSON(docSchema, docJson);
  for (const stepJson of steps) {
    const step = Step.fromJSON(docSchema, stepJson);
    const result = step.apply(doc);
    if (result.failed !== null || !result.doc) {
      throw new Error(`Step failed: ${result.failed ?? "no document produced"}`);
    }
    doc = result.doc;
  }
  return doc.toJSON() as DocJSON;
}

/**
 * Map a position through a sequence of steps. `bias` (-1 | 1) decides which
 * side content inserted exactly at the position lands on. This is how a comment
 * anchor stays pinned when text changes elsewhere in the doc.
 */
export function mapPositionThroughSteps(
  pos: number,
  steps: StepJSON[],
  bias: -1 | 1 = 1
): number {
  let mapped = pos;
  for (const stepJson of steps) {
    const step = Step.fromJSON(docSchema, stepJson);
    mapped = step.getMap().map(mapped, bias);
  }
  return mapped;
}
