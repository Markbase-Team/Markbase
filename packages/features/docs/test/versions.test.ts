import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createDoc, setMarkdown } from "../src/logic/crdt";
import {
  appendVersion,
  listVersions,
  versionContent,
  versionCount,
  shouldCheckpoint,
  KEYFRAME_EVERY,
} from "../src/logic/versions";

// Versioning (roadmap B3).
//
// A version is a markdown diff, stored as an item in a Y.Array inside the SAME
// Y.Doc as the content. That placement is the whole design:
//
//   * It keeps the roadmap's promise (lines 50/59/69-71) that versions live in the
//     CRDT and travel in the sidecar — an iCloud-only vault still has its history,
//     with no server involved.
//   * It avoids Y.snapshot(), which would force gc:false on every document. A
//     snapshot is an 18-byte RECEIPT; redeeming it means keeping every character
//     ever deleted, forever, in the live doc — measured at up to 300x, paid on
//     every open by everyone, to serve a history view most people rarely look at.
//
// The Y.Text stays garbage-collected and lean; versions accumulate beside it and
// are only read when someone asks.

const mdOf = (doc: Y.Doc, s: string) => setMarkdown(doc, s);

describe("appendVersion / versionContent", () => {
  it("records a version and reads it back exactly", () => {
    const doc = createDoc("# One\n");
    expect(appendVersion(doc, "# One\n")).toBe(true);
    expect(versionCount(doc)).toBe(1);
    expect(versionContent(doc, 0)).toBe("# One\n");
  });

  it("reconstructs each version from its patch chain", () => {
    const doc = createDoc("");
    const states = ["# A\n", "# A\n\nbody\n", "# A\n\nbody edited\n", "# B\n\nbody edited\n"];
    for (const s of states) appendVersion(doc, s);
    expect(versionCount(doc)).toBe(4);
    states.forEach((s, i) => expect(versionContent(doc, i)).toBe(s));
  });

  // The daemon flushes constantly and the editor fires on every keystroke; without
  // this the log would fill with thousands of identical entries.
  it("refuses to record a version identical to the last", () => {
    const doc = createDoc("");
    expect(appendVersion(doc, "# Same\n")).toBe(true);
    expect(appendVersion(doc, "# Same\n")).toBe(false);
    expect(versionCount(doc)).toBe(1);
  });

  it("carries a label and an author for a named version", () => {
    const doc = createDoc("");
    appendVersion(doc, "# Draft\n", { label: "First draft", author: "Jessie", at: 1000 });
    const [v] = listVersions(doc);
    expect(v).toMatchObject({ label: "First draft", author: "Jessie", at: 1000 });
  });

  // An agent's author names WHOSE agent it was — the label is composed upstream
  // (see @markbase/protocol/attribution) and stored as an ordinary string, so the
  // log needs no new shape to carry it.
  it("carries an agent's author verbatim", () => {
    const doc = createDoc("");
    appendVersion(doc, "# By an agent\n", { author: "Jessie's Claude Code", at: 2000 });
    expect(listVersions(doc)[0].author).toBe("Jessie's Claude Code");
  });

  // Versions are read back out of the CRDT on every surface; an author that
  // survived the append but not the merge would attribute silently wrongly.
  it("keeps each version's author when two devices merge", () => {
    const a = createDoc("");
    const b = createDoc("");
    appendVersion(a, "# Shared\n", { author: "Jessie", at: 1 });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    appendVersion(a, "# Shared\n\nfrom the vault\n", { author: "Jessie", at: 2 });
    appendVersion(b, "# Shared\n\nfrom an agent\n", { author: "Jessie's Claude Code", at: 3 });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // WHICH order the concurrent pair merges into is Yjs's business — it falls
    // out of randomly assigned client ids, so asserting one would pass or fail
    // by luck. What matters is that no author was lost, and that both devices
    // tell the same story.
    expect([...listVersions(a).map((v) => v.author)].sort()).toEqual([
      "Jessie",
      "Jessie",
      "Jessie's Claude Code",
    ]);
    expect(listVersions(b).map((v) => v.author)).toEqual(listVersions(a).map((v) => v.author));
  });

  it("summarizes what changed, so a history list needs no reconstruction", () => {
    const doc = createDoc("");
    appendVersion(doc, "one two three\n");
    appendVersion(doc, "one two three four five\n");
    const v = listVersions(doc)[1];
    expect(v.added).toBe(2); // "four five"
    expect(v.removed).toBe(0);
  });

  it("survives content the diff format could choke on", () => {
    const doc = createDoc("");
    const nasty = ["--- not a header\n+++ nor this\n@@ fake hunk @@\n", "\n\n\n", "no trailing newline"];
    for (const s of nasty) appendVersion(doc, s);
    nasty.forEach((s, i) => expect(versionContent(doc, i)).toBe(s));
  });
});

// Patches are 10x smaller than a full copy on a real document — but on a SMALL one
// the unified-diff header costs more than the content it describes. Storing
// whichever is smaller means the log is never worse than snapshotting, and much
// better on the documents where it matters.
describe("storage shape", () => {
  it("stores a keyframe periodically, so reconstruction can't walk forever", () => {
    const doc = createDoc("");
    for (let i = 0; i <= KEYFRAME_EVERY + 1; i++) appendVersion(doc, `# Doc\n\nrevision ${i}\n`);
    const entries = doc.getArray("versions").toArray() as Array<{ full?: string }>;
    expect(entries[0].full).toBeDefined(); // the first is always whole
    expect(entries[KEYFRAME_EVERY].full).toBeDefined();
    // and content still reads correctly across the keyframe boundary
    expect(versionContent(doc, KEYFRAME_EVERY + 1)).toBe(`# Doc\n\nrevision ${KEYFRAME_EVERY + 1}\n`);
  });

  it("prefers a patch when it's genuinely smaller", () => {
    const doc = createDoc("");
    const big = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}. Some prose here.`).join("\n\n");
    appendVersion(doc, big);
    appendVersion(doc, big.replace("Paragraph 30.", "Paragraph 30 (revised)."));
    const entries = doc.getArray("versions").toArray() as Array<{ full?: string; patch?: string }>;
    expect(entries[1].patch).toBeDefined();
    expect(entries[1].full).toBeUndefined();
    expect(entries[1].patch!.length).toBeLessThan(big.length);
  });

  it("falls back to the full text when a patch would cost more", () => {
    const doc = createDoc("");
    appendVersion(doc, "a\n");
    appendVersion(doc, "b\n"); // a patch's header dwarfs two bytes of content
    const entries = doc.getArray("versions").toArray() as Array<{ full?: string }>;
    expect(entries[1].full).toBe("b\n");
  });
});

// Two devices can append at once — that's what a Y.Array is FOR. Both must
// survive; neither may clobber the other.
describe("concurrent appends", () => {
  it("merges versions written on two devices offline", () => {
    const a = createDoc("");
    const b = createDoc("");
    appendVersion(a, "# Shared\n", { at: 1 });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); // b syncs, then both go offline

    appendVersion(a, "# Shared\n\nfrom A\n", { at: 2 });
    appendVersion(b, "# Shared\n\nfrom B\n", { at: 3 });

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Neither edit is lost, and both devices agree on the order.
    expect(versionCount(a)).toBe(3);
    expect(listVersions(a).map((v) => v.at)).toEqual(listVersions(b).map((v) => v.at));
  });
});

// The op-log already records every keystroke. A VERSION should mean "a thought
// finished" — otherwise history is a wall of noise nobody can navigate.
describe("shouldCheckpoint — cadence", () => {
  const MIN = 60_000;
  const base = {
    now: 100 * MIN,
    lastEditAt: 100 * MIN,
    lastVersionAt: 99 * MIN,
    lastVersionContent: "old",
    content: "new",
  };

  it("takes the first version as soon as there's content", () => {
    expect(shouldCheckpoint({ ...base, lastVersionAt: null })).toBe(true);
  });

  it("never records when nothing changed", () => {
    expect(shouldCheckpoint({ ...base, content: "old", lastVersionAt: null })).toBe(false);
  });

  it("waits while the user is still typing", () => {
    // edited 10s ago: they're mid-thought, not finished
    expect(shouldCheckpoint({ ...base, lastEditAt: base.now - 10_000 })).toBe(false);
  });

  it("records once editing settles", () => {
    expect(shouldCheckpoint({ ...base, lastEditAt: base.now - 3 * MIN })).toBe(true);
  });

  // Otherwise a two-hour writing session collapses into a single useless version.
  it("records during a long unbroken session anyway", () => {
    expect(
      shouldCheckpoint({
        ...base,
        lastEditAt: base.now, // still typing right now
        lastVersionAt: base.now - 11 * MIN, // but it's been 11 minutes
      })
    ).toBe(true);
  });
});
