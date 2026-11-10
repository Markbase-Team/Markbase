import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { mergeSnapshot } from "../src/logic/crdt-merge";
import { createDoc, getMarkdown, setMarkdown } from "../src/logic/crdt";
import { restore, snapshot } from "../src/logic/sync";

// The merge the server performs on every save. It replaces an upsert, so what
// matters is what the upsert lost: an edit the saving client had not received.

describe("mergeSnapshot", () => {
  it("stores the first snapshot as-is", () => {
    const state = snapshot(createDoc("# One\n"));
    const m = mergeSnapshot(null, state);
    expect(m.changed).toBe(true);
    expect(m.state).toBe(state);
    expect(m.delta).toBe(state);
  });

  it("keeps both sides' edits when a replica that is behind saves", () => {
    const a = createDoc("# Doc\n\nbase\n");
    const b = restore(snapshot(a)); // a second replica, in step
    setMarkdown(a, "# Doc\n\nbase\n\nfrom A\n");
    setMarkdown(b, "# Doc\n\nfrom B\n\nbase\n");

    const stored = snapshot(a); // A saved first
    const m = mergeSnapshot(stored, snapshot(b)); // B saves without A's edit
    expect(m.changed).toBe(true);
    const md = getMarkdown(restore(m.state));
    expect(md).toContain("from A");
    expect(md).toContain("from B");
  });

  it("reports no change when the stored state already holds the incoming one", () => {
    const a = createDoc("# Doc\n");
    const stored = snapshot(a);
    const stale = restore(stored);
    // B is exactly in step; saving it adds nothing.
    const m = mergeSnapshot(stored, snapshot(stale));
    expect(m.changed).toBe(false);
    expect(m.delta).toBeNull();
    expect(m.state).toBe(stored);
  });

  it("reports no change for a replica that is strictly behind", () => {
    const a = createDoc("# Doc\n");
    const old = snapshot(a);
    setMarkdown(a, "# Doc\n\nnewer\n");
    const stored = snapshot(a);
    // An old snapshot arriving late must not undo anything, and is not a change.
    const m = mergeSnapshot(stored, old);
    expect(m.changed).toBe(false);
    expect(getMarkdown(restore(m.state))).toContain("newer");
  });

  it("the delta brings a peer at the stored state up to the merged one", () => {
    const a = createDoc("# Doc\n");
    const stored = snapshot(a);
    const b = restore(stored);
    setMarkdown(b, "# Doc\n\nedit\n");
    const m = mergeSnapshot(stored, snapshot(b));

    const peer = restore(stored);
    Y.applyUpdate(peer, m.delta!);
    expect(getMarkdown(peer)).toBe("# Doc\n\nedit\n");
    // and it is smaller than the whole state — it is what a keystroke costs
    expect(m.delta!.length).toBeLessThan(m.state.length);
  });

  it("refuses bytes that are not a Yjs update", () => {
    expect(() => mergeSnapshot(null, new Uint8Array([1, 2, 3, 4, 5]))).toThrow();
    expect(() => mergeSnapshot(snapshot(createDoc("x")), new Uint8Array([255, 255]))).toThrow();
  });
});
