import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createDoc, setMarkdown, getMarkdown } from "../src/logic/crdt";
import { createUndoManager } from "../src/logic/undo";

describe("undo: local edits", () => {
  it("undo reverts tracked edits in reverse order; redo re-applies", () => {
    const doc = createDoc("v0\n");
    const um = createUndoManager(doc, ["editor"]);
    setMarkdown(doc, "v1\n", "editor");
    um.stopCapturing();
    setMarkdown(doc, "v2\n", "editor");
    expect(getMarkdown(doc)).toBe("v2\n");
    um.undo();
    expect(getMarkdown(doc)).toBe("v1\n");
    um.undo();
    expect(getMarkdown(doc)).toBe("v0\n");
    um.redo();
    expect(getMarkdown(doc)).toBe("v1\n");
  });

  it("has nothing to undo before any tracked edit", () => {
    const doc = createDoc("start\n");
    const um = createUndoManager(doc, ["editor"]);
    expect(um.canUndo()).toBe(false);
    setMarkdown(doc, "changed\n", "editor");
    expect(um.canUndo()).toBe(true);
  });
});

describe("undo: leaves other people's changes alone", () => {
  it("does not undo an untracked remote edit, and keeps it through a local undo", () => {
    const a = createDoc("base\n");
    const b = createDoc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const um = createUndoManager(a, ["editor"]);
    // local editor edit on A (tracked)
    setMarkdown(a, "base\nlocal line\n", "editor");
    // a remote edit lands from B (untracked origin)
    setMarkdown(b, "base\nremote line\n", "remote");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    expect(getMarkdown(a)).toContain("local line");
    expect(getMarkdown(a)).toContain("remote line");
    // undo reverts ONLY the local edit; the remote edit survives
    um.undo();
    expect(getMarkdown(a)).not.toContain("local line");
    expect(getMarkdown(a)).toContain("remote line");
  });

  it("does not track a file-intake edit when only 'editor' is tracked", () => {
    const doc = createDoc("start\n");
    const um = createUndoManager(doc, ["editor"]);
    setMarkdown(doc, "from a file\n", "vault:file"); // agent/vim wrote the file
    expect(um.canUndo()).toBe(false); // not an editor edit → not undoable
  });
});
