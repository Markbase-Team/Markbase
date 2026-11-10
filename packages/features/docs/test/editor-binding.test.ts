import { describe, it, expect } from "vitest";
import { createDoc, getMarkdown, setMarkdown } from "../src/logic/crdt";
import { docJsonToMarkdown } from "../src/logic/markdown";
import { EditorBinding, type EditorBridge } from "../src/logic/editor-binding";
import type { DocJSON } from "../src/logic/types";

// A stand-in for a real Tiptap editor: holds markdown, records writes, and can
// mimic the editor firing its own change event when content is replaced.
class FakeEditor implements EditorBridge {
  content: string;
  writes = 0;
  onExternalWrite?: () => void; // simulate the editor's onUpdate after writeContent
  constructor(initial = "") {
    this.content = initial;
  }
  readMarkdown(): string {
    return this.content;
  }
  writeContent(doc: DocJSON): void {
    this.writes++;
    this.content = docJsonToMarkdown(doc).replace(/\n+$/, "\n");
    this.onExternalWrite?.();
  }
}

describe("EditorBinding", () => {
  it("flows an editor edit into the CRDT (markdown is truth)", () => {
    const doc = createDoc("");
    const ed = new FakeEditor("# Hi\n");
    const b = new EditorBinding(doc, ed);
    b.editorChanged();
    expect(getMarkdown(doc)).toBe("# Hi\n");
    b.destroy();
  });

  it("pushes a remote CRDT change back into the editor", () => {
    const doc = createDoc("start\n");
    const ed = new FakeEditor("start\n");
    const b = new EditorBinding(doc, ed);
    setMarkdown(doc, "start\nfrom the cloud\n", "remote");
    expect(ed.writes).toBe(1);
    expect(ed.content).toContain("from the cloud");
    b.destroy();
  });

  it("does not echo: an editor-origin change never calls back into the editor", () => {
    const doc = createDoc("");
    const ed = new FakeEditor("# Typed\n");
    const b = new EditorBinding(doc, ed);
    b.editorChanged();
    expect(ed.writes).toBe(0); // the editor already has this content
    b.destroy();
  });

  it("no loop when the editor fires onUpdate in response to our writeContent", () => {
    const doc = createDoc("base\n");
    const ed = new FakeEditor("base\n");
    const b = new EditorBinding(doc, ed);
    // Real editors fire onUpdate when their content is replaced; wire that to
    // editorChanged as a real integration would. The binding must swallow it.
    ed.onExternalWrite = () => b.editorChanged();

    setMarkdown(doc, "base\nremote line\n", "remote");
    // writeContent ran once; the re-entrant editorChanged was a no-op, so the
    // CRDT still holds the remote text exactly once (no duplication).
    expect(ed.writes).toBe(1);
    expect(getMarkdown(doc)).toBe("base\nremote line\n");
    b.destroy();
  });
});
