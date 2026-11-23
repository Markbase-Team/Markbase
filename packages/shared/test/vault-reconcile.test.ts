import { describe, it, expect } from "vitest";
import { planReconcile } from "../src/vault-reconcile";

// The daemon read every document's path ONCE, at startup. So a move made on the
// web — or a convert, which re-bases a whole folder's paths into another vault —
// was invisible until someone restarted it. Worse than invisible: the daemon kept
// writing each doc at its stale path, so the next restart found files in two
// places and adopted the strays as new documents.
//
// Reconciling is a diff: what we hold, versus what the cloud now says. Pure, so
// the interesting cases are cheap to state.
const ref = (id: string, path: string) => ({ id, path });

describe("planReconcile", () => {
  it("does nothing when the cloud agrees with us", () => {
    const held = [ref("a", "inbox.md"), ref("b", "projects/q1.md")];
    expect(planReconcile(held, held)).toEqual({ open: [], move: [], close: [] });
  });

  it("opens a document created elsewhere", () => {
    const plan = planReconcile([ref("a", "inbox.md")], [ref("a", "inbox.md"), ref("b", "new.md")]);
    expect(plan.open).toEqual([ref("b", "new.md")]);
    expect(plan.move).toEqual([]);
    expect(plan.close).toEqual([]);
  });

  // The web drag. Identity is the doc id, so this is a move, not a delete+create:
  // matching on path instead would lose the CRDT and duplicate the file.
  it("moves a document whose path changed in the cloud", () => {
    const plan = planReconcile([ref("a", "inbox.md")], [ref("a", "projects/inbox.md")]);
    expect(plan.move).toEqual([{ id: "a", from: "inbox.md", to: "projects/inbox.md" }]);
    expect(plan.open).toEqual([]);
    expect(plan.close).toEqual([]);
  });

  it("closes a document that left our vault (deleted, or converted away)", () => {
    const plan = planReconcile([ref("a", "inbox.md"), ref("b", "gone.md")], [ref("a", "inbox.md")]);
    expect(plan.close).toEqual([ref("b", "gone.md")]);
    expect(plan.open).toEqual([]);
  });

  // A convert re-bases a whole folder into a new vault: from our side every doc
  // under that folder simply stops being ours, all at once.
  it("closes every doc a convert took, and keeps the rest", () => {
    const held = [
      ref("a", "projects/roadmap.md"),
      ref("b", "projects/2026/q1.md"),
      ref("c", "inbox.md"),
    ];
    const plan = planReconcile(held, [ref("c", "inbox.md")]);
    expect(plan.close).toEqual([ref("a", "projects/roadmap.md"), ref("b", "projects/2026/q1.md")]);
    expect(plan.move).toEqual([]);
  });

  it("handles a move and an open and a close in one pass", () => {
    const plan = planReconcile(
      [ref("a", "inbox.md"), ref("b", "old.md")],
      [ref("a", "moved/inbox.md"), ref("c", "fresh.md")]
    );
    expect(plan.move).toEqual([{ id: "a", from: "inbox.md", to: "moved/inbox.md" }]);
    expect(plan.open).toEqual([ref("c", "fresh.md")]);
    expect(plan.close).toEqual([ref("b", "old.md")]);
  });

  // THE RACE. A poll's list is a snapshot from before the request; adopting a new
  // file while it's in flight means the reply legitimately doesn't mention that
  // doc. Closing on that basis would retire a file the user just created — data
  // loss caused purely by timing. Only docs we knew about BEFORE the fetch began
  // are eligible to close.
  describe("the in-flight adoption race", () => {
    it("never closes a doc adopted while the fetch was in flight", () => {
      const knownBefore = new Set(["a"]);
      const plan = planReconcile(
        [ref("a", "inbox.md"), ref("fresh", "just-written.md")], // adopted mid-fetch
        [ref("a", "inbox.md")], // the reply predates it
        knownBefore
      );
      expect(plan.close).toEqual([]); // NOT closed — we simply hadn't asked about it
    });

    it("still closes a doc that was known before the fetch and is now gone", () => {
      const knownBefore = new Set(["a", "b"]);
      const plan = planReconcile(
        [ref("a", "inbox.md"), ref("b", "gone.md")],
        [ref("a", "inbox.md")],
        knownBefore
      );
      expect(plan.close).toEqual([ref("b", "gone.md")]);
    });
  });
});
