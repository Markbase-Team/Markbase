import { describe, it, expect } from "vitest";
import { createDoc, setMarkdown } from "../../src/docs/crdt";
import { listVersions, versionCount } from "../../src/docs/versions";
import { VersionTracker } from "../../src/docs/version-tracker";
import { EDITOR_ORIGIN } from "../../src/docs/editor-binding";

// The browser's idle ticker and the daemon's sweep share this. What it must
// never do is the bug it replaces: cut a version for text that arrived from
// somewhere else, crediting an agent's edit to whoever had the document open.

const IDLE = 3 * 60_000;

describe("VersionTracker", () => {
  it("records what came in under its own origin, once it settles", () => {
    const doc = createDoc("");
    const t = new VersionTracker(doc, EDITOR_ORIGIN);
    setMarkdown(doc, "typed here\n", EDITOR_ORIGIN);
    expect(t.due(Date.now() + IDLE)).toBe(true);
    expect(t.record({ author: "Jessie" })).toBe(true);
    expect(listVersions(doc)[0].author).toBe("Jessie");
    expect(t.due(Date.now() + 2 * IDLE)).toBe(false); // nothing new
  });

  it("refuses what arrived under another origin, however long it sits", () => {
    const doc = createDoc("");
    const t = new VersionTracker(doc, EDITOR_ORIGIN);
    setMarkdown(doc, "an agent wrote this through the API\n", "remote");
    expect(t.due(Date.now() + 10 * IDLE)).toBe(false);
    expect(versionCount(doc)).toBe(0);
  });

  it("is the last change that decides whose turn it is", () => {
    const doc = createDoc("");
    const t = new VersionTracker(doc, EDITOR_ORIGIN);
    setMarkdown(doc, "mine\n", EDITOR_ORIGIN);
    setMarkdown(doc, "mine\ntheirs\n", "remote");
    expect(t.due(Date.now() + IDLE)).toBe(false);
    setMarkdown(doc, "mine\ntheirs\nmine again\n", EDITOR_ORIGIN);
    expect(t.due(Date.now() + IDLE)).toBe(true);
  });

  it("picks up where the document's history left off", () => {
    const doc = createDoc("");
    const first = new VersionTracker(doc, EDITOR_ORIGIN);
    setMarkdown(doc, "a\n", EDITOR_ORIGIN);
    first.record({ author: "Jessie" }, 1_000);
    first.stop();

    const again = new VersionTracker(doc, EDITOR_ORIGIN);
    expect(again.lastVersionAt).toBe(1_000);
    expect(again.lastVersionContent).toBe("a\n");
    // The same text is not a new version, and an edit is only due once settled.
    setMarkdown(doc, "a\n", EDITOR_ORIGIN);
    expect(again.due(Date.now() + IDLE)).toBe(false);
  });

  it("stops observing when stopped", () => {
    const doc = createDoc("");
    const t = new VersionTracker(doc, EDITOR_ORIGIN);
    t.stop();
    setMarkdown(doc, "after\n", EDITOR_ORIGIN);
    expect(t.due(Date.now() + IDLE)).toBe(false);
  });
});
