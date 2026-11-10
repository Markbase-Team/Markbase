import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createDoc, setMarkdown } from "../src/logic/crdt";
import {
  addComment,
  addReply,
  listCommentThreads,
  resolveComment,
  deleteComment,
  commentRanges,
  offsetForQuote,
} from "../src/logic/doc-comments";

// Comments in the CRDT (roadmap B1). They live in a Y.Array in the SAME Y.Doc as
// the content — so they sync over the one channel, travel in the sidecar, and, by
// anchoring on Yjs RELATIVE positions, stay on their text through any edit. The
// old system pinned comments to a quoted string and re-found it by search, which
// broke on duplicates and drifted under edits.
//
// Threading and resolve mean comments MUTATE, unlike append-only versions — so
// each comment is a Y.Map (concurrent field edits converge), not a frozen object.

const author = { name: "Jessie", id: "u1" };

describe("addComment / listCommentThreads", () => {
  it("anchors a comment over a span and reads it back with the quote", () => {
    const doc = createDoc("The quick brown fox.\n");
    const from = "The quick ".length;
    const to = "The quick brown".length;
    addComment(doc, { from, to, body: "which brown?", author });

    const threads = listCommentThreads(doc);
    expect(threads).toHaveLength(1);
    expect(threads[0].body).toBe("which brown?");
    expect(threads[0].quote).toBe("brown");
    expect(threads[0].range).toEqual({ from, to });
    expect(threads[0].orphaned).toBe(false);
  });

  // The whole point: an edit BEFORE the anchor must carry it along, not leave it
  // pointing at the wrong characters (what raw offsets or a quote-search would do).
  it("keeps the anchor on its text when earlier text is inserted", () => {
    const doc = createDoc("brown fox\n");
    addComment(doc, { from: 0, to: 5, body: "c", author }); // anchors "brown"
    // someone types at the very start
    const t = doc.getText("source");
    t.insert(0, "The quick ");

    const [thread] = listCommentThreads(doc);
    expect(thread.quote).toBe("brown"); // still on "brown", now shifted right
    expect(thread.range).toEqual({ from: 10, to: 15 });
    expect(thread.orphaned).toBe(false);
  });

  // When the anchored text is deleted the anchor collapses — surface it as
  // orphaned (kept, shown against its stored quote) rather than silently moving.
  it("marks a comment orphaned when its text is deleted", () => {
    const doc = createDoc("keep DELETEME keep\n");
    addComment(doc, { from: 5, to: 13, body: "c", author }); // "DELETEME"
    const t = doc.getText("source");
    t.delete(5, 8);

    const [thread] = listCommentThreads(doc);
    expect(thread.orphaned).toBe(true);
    expect(thread.range).toBeNull();
    expect(thread.quote).toBe("DELETEME"); // the stored quote, so it's still readable
  });
});

describe("threads — reply + resolve", () => {
  it("nests replies under their root, oldest first", () => {
    const doc = createDoc("x\n");
    const root = addComment(doc, { from: 0, to: 1, body: "root", author, at: 1 });
    addReply(doc, { parentId: root.id, body: "reply A", author, at: 2 });
    addReply(doc, { parentId: root.id, body: "reply B", author, at: 3 });

    const [thread] = listCommentThreads(doc);
    expect(thread.replies.map((r) => r.body)).toEqual(["reply A", "reply B"]);
    // replies aren't top-level threads
    expect(listCommentThreads(doc)).toHaveLength(1);
  });

  it("resolves and unresolves a thread by its root", () => {
    const doc = createDoc("x\n");
    const root = addComment(doc, { from: 0, to: 1, body: "root", author });
    expect(listCommentThreads(doc)[0].resolved).toBe(false);

    resolveComment(doc, root.id, true);
    expect(listCommentThreads(doc)[0].resolved).toBe(true);
    resolveComment(doc, root.id, false);
    expect(listCommentThreads(doc)[0].resolved).toBe(false);
  });

  it("deletes a thread and its replies together", () => {
    const doc = createDoc("x\n");
    const root = addComment(doc, { from: 0, to: 1, body: "root", author });
    addReply(doc, { parentId: root.id, body: "r", author });
    deleteComment(doc, root.id);
    expect(listCommentThreads(doc)).toHaveLength(0);
  });
});

describe("commentRanges — what the editor highlights", () => {
  it("returns unresolved, non-orphaned root ranges only", () => {
    const doc = createDoc("aaaa bbbb cccc\n");
    const a = addComment(doc, { from: 0, to: 4, body: "a", author }); // "aaaa"
    addComment(doc, { from: 5, to: 9, body: "b", author }); // "bbbb"
    const c = addComment(doc, { from: 10, to: 14, body: "c", author }); // "cccc"

    resolveComment(doc, a.id, true); // resolved → not highlighted
    doc.getText("source").delete(10, 4); // orphan c

    expect(commentRanges(doc)).toEqual([{ from: 5, to: 9, id: expect.any(String) }]);
    void c;
  });
});

// Two people commenting at once is the reason this lives in a CRDT at all.
describe("concurrent editing", () => {
  it("merges comments added on two devices offline", () => {
    const a = createDoc("shared text here\n");
    const b = createDoc("");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // b clones a

    addComment(a, { from: 0, to: 6, body: "from A", author, at: 1 });
    addComment(b, { from: 7, to: 11, body: "from B", author, at: 2 });

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(listCommentThreads(a)).toHaveLength(2);
    expect(listCommentThreads(a).map((t) => t.body)).toEqual(
      listCommentThreads(b).map((t) => t.body)
    );
  });

  it("converges when two devices resolve the same thread", () => {
    const a = createDoc("x\n");
    const root = addComment(a, { from: 0, to: 1, body: "r", author });
    const b = createDoc("");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    resolveComment(a, root.id, true);
    resolveComment(b, root.id, true);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(listCommentThreads(a)[0].resolved).toBe(true);
    expect(listCommentThreads(b)[0].resolved).toBe(true);
  });
});

// The bridge from a selected quote to a source offset — the one piece of real
// logic that used to live untested inside the React hook. A quote can appear more
// than once, so anchoring the WRONG occurrence is a genuine bug.
describe("offsetForQuote — selection quote → source offset", () => {
  it("finds a unique quote", () => {
    expect(offsetForQuote("the quick brown fox", "brown")).toEqual({ from: 10, to: 15 });
  });

  it("returns null when the quote isn't there (stale selection)", () => {
    expect(offsetForQuote("hello world", "goodbye")).toBeNull();
    expect(offsetForQuote("hello", "")).toBeNull();
  });

  it("without a hint, takes the first occurrence", () => {
    expect(offsetForQuote("the cat sat on the mat", "the")).toEqual({ from: 0, to: 3 });
  });

  // The real fix: comment on the SECOND "the" and the hint picks it, not the first.
  it("with a hint, takes the occurrence nearest the selection", () => {
    const src = "the cat sat on the mat"; // "the" at 0 and 15
    expect(offsetForQuote(src, "the", 14)).toEqual({ from: 15, to: 18 });
    expect(offsetForQuote(src, "the", 2)).toEqual({ from: 0, to: 3 });
  });
});

// Edge cases the first pass didn't pin.
describe("anchor + thread edge cases", () => {
  // Inserting INSIDE the anchored span must grow it — the comment still covers all
  // the text it was pinned to, plus what was typed into the middle.
  it("grows the anchor when text is inserted inside it", () => {
    const doc = createDoc("brown fox\n");
    addComment(doc, { from: 0, to: 5, body: "c", author }); // "brown"
    doc.getText("source").insert(2, "XX"); // brXXown

    const [t] = listCommentThreads(doc);
    expect(t.quote).toBe("brXXown");
    expect(t.range).toEqual({ from: 0, to: 7 });
  });

  // Editing AFTER the anchor leaves it exactly where it was.
  it("leaves the anchor untouched when later text changes", () => {
    const doc = createDoc("brown fox jumps\n");
    addComment(doc, { from: 0, to: 5, body: "c", author });
    doc.getText("source").insert(9, " high"); // after the anchor
    expect(listCommentThreads(doc)[0].range).toEqual({ from: 0, to: 5 });
  });

  it("deletes a single reply without touching the root or its siblings", () => {
    const doc = createDoc("x\n");
    const root = addComment(doc, { from: 0, to: 1, body: "root", author, at: 1 });
    const r1 = addReply(doc, { parentId: root.id, body: "keep", author, at: 2 });
    const r2 = addReply(doc, { parentId: root.id, body: "drop", author, at: 3 });
    deleteComment(doc, r2.id);

    const [thread] = listCommentThreads(doc);
    expect(thread.body).toBe("root");
    expect(thread.replies.map((r) => r.body)).toEqual(["keep"]);
    void r1;
  });

  // A reply whose root is gone (deleted, or a stale id) is neither a thread nor a
  // crash — it's simply not shown.
  it("ignores a reply with no surviving root", () => {
    const doc = createDoc("x\n");
    addReply(doc, { parentId: "does-not-exist", body: "orphan reply", author });
    expect(listCommentThreads(doc)).toEqual([]);
  });

  it("is a no-op to resolve or delete an id that isn't there", () => {
    const doc = createDoc("x\n");
    addComment(doc, { from: 0, to: 1, body: "r", author });
    expect(() => resolveComment(doc, "nope", true)).not.toThrow();
    expect(() => deleteComment(doc, "nope")).not.toThrow();
    expect(listCommentThreads(doc)).toHaveLength(1); // untouched
  });

  // Concurrency where it's hardest: one device edits the anchored text while
  // another comments on it. After merge the anchor must still resolve, not throw.
  it("resolves an anchor even when the text was concurrently edited", () => {
    const a = createDoc("the target word\n");
    const b = createDoc("");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    addComment(a, { from: 4, to: 10, body: "c", author }); // "target"
    b.getText("source").insert(0, "PREFIX "); // b shifts everything right

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const [t] = listCommentThreads(a);
    expect(t.orphaned).toBe(false);
    expect(t.quote).toBe("target"); // still on its word, wherever it moved
  });
});

// The WIRING pieces, extracted from React so they're testable against a real
// Y.Doc / DocJSON — no component harness. These are where the highlight actually
// broke during development, so they earn a test.
import { markdownToDoc } from "../src/logic/markdown";
import { commentHighlightRanges, watchComments } from "../src/logic/doc-comments";
import type { DocJSON } from "../src/logic/types";

describe("commentHighlightRanges — the editor highlight logic", () => {
  const docJson = markdownToDoc("The quick brown fox jumps.\n").toJSON() as DocJSON;
  const thread = (over: Partial<CommentView>): CommentView => ({
    id: "x", parentId: null, body: "b", authorName: "a", authorId: null, at: 0,
    resolved: false, quote: "", range: null, orphaned: false, replies: [],
    ...over,
  });

  it("returns a range for each live, quoted, unresolved thread", () => {
    const ranges = commentHighlightRanges([thread({ quote: "brown" })], docJson);
    expect(ranges).toHaveLength(1);
    // "brown" sits mid-sentence, so a non-zero range that isn't the whole doc
    expect(ranges[0].from).toBeGreaterThan(0);
    expect(ranges[0].to).toBeGreaterThan(ranges[0].from);
  });

  it("skips resolved, orphaned, and quoteless threads", () => {
    const threads = [
      thread({ quote: "brown", resolved: true }),
      thread({ quote: "quick", orphaned: true }),
      thread({ quote: "" }),
    ];
    expect(commentHighlightRanges(threads, docJson)).toEqual([]);
  });

  it("skips a quote that isn't in the current document (edited away)", () => {
    expect(commentHighlightRanges([thread({ quote: "purple" })], docJson)).toEqual([]);
  });
});

// A CommentView type import for the helper above (kept local to this block).
import type { CommentView } from "../src/logic/doc-comments";

describe("watchComments — observe → emit", () => {
  it("emits the current threads immediately", () => {
    const doc = createDoc("hello world\n");
    addComment(doc, { from: 0, to: 5, body: "c", author });
    let seen: CommentView[] = [];
    const stop = watchComments(doc, (t) => (seen = t));
    expect(seen).toHaveLength(1);
    stop();
  });

  it("fires when a comment is ADDED", () => {
    const doc = createDoc("hello world\n");
    let count = -1;
    const stop = watchComments(doc, (t) => (count = t.length));
    expect(count).toBe(0);
    addComment(doc, { from: 0, to: 5, body: "c", author });
    expect(count).toBe(1);
    stop();
  });

  // The deep-observe reason: a resolve edits a field INSIDE a comment Y.Map.
  it("fires when a comment is RESOLVED (a field edit inside an item)", () => {
    const doc = createDoc("hello\n");
    const root = addComment(doc, { from: 0, to: 5, body: "c", author });
    let last: CommentView[] = [];
    const stop = watchComments(doc, (t) => (last = t));
    resolveComment(doc, root.id, true);
    expect(last[0].resolved).toBe(true);
    stop();
  });

  it("stops emitting after detach", () => {
    const doc = createDoc("hello\n");
    let calls = 0;
    const stop = watchComments(doc, () => calls++);
    const afterInitial = calls; // the immediate emit
    stop();
    addComment(doc, { from: 0, to: 5, body: "c", author });
    expect(calls).toBe(afterInitial); // no further emissions
  });
});
