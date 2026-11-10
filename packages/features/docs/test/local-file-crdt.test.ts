import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getMarkdown, setMarkdown } from "../src/logic/crdt";
import { LocalFileSession, localDocId, isLocalDocId } from "../src/ui/local-file-crdt";
import type { LocalFile, LocalFilePort, LocalSaveResult } from "../src/ui/ports";

// The disk side, as the session sees it: what was written, in order, and a way
// to make a write fail or to announce a change made by something else.
class FakeBridge implements LocalFilePort {
  writes: string[] = [];
  edited: boolean[] = [];
  failWith: string | null = null;
  changed: ((file: LocalFile) => void) | null = null;
  private flush: (() => Promise<LocalSaveResult>) | null = null;

  save = async (content: string): Promise<LocalSaveResult> => {
    if (this.failWith) return { ok: false, error: this.failWith };
    this.writes.push(content);
    return { ok: true };
  };
  setEdited = (edited: boolean): void => {
    this.edited.push(edited);
  };
  onChanged = (cb: (file: LocalFile) => void): (() => void) => {
    this.changed = cb;
    return () => {
      this.changed = null;
    };
  };
  onFlush = (cb: () => Promise<LocalSaveResult>): (() => void) => {
    this.flush = cb;
    return () => {
      this.flush = null;
    };
  };

  /** Something else wrote the file. */
  diskNow(content: string): void {
    this.changed?.({ path: "/p/a.md", dir: "/p", name: "a.md", content });
  }
  /** The shell is closing the window. */
  closeWindow(): Promise<LocalSaveResult> {
    if (!this.flush) throw new Error("no flush handler");
    return this.flush();
  }
}

describe("local doc ids", () => {
  it("prefix an absolute path and nothing else", () => {
    expect(isLocalDocId(localDocId("/Users/me/notes.md"))).toBe(true);
    expect(isLocalDocId("3f1c-…-cloud-id")).toBe(false);
  });
});

describe("LocalFileSession", () => {
  let bridge: FakeBridge;
  beforeEach(() => {
    vi.useFakeTimers();
    bridge = new FakeBridge();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("seeds the Y.Doc from the file and writes nothing until edited", () => {
    const s = new LocalFileSession(bridge, "# Hi\n");
    expect(getMarkdown(s.doc)).toBe("# Hi\n");
    vi.advanceTimersByTime(5_000);
    expect(bridge.writes).toEqual([]);
    expect(s.getState().dirty).toBe(false);
  });

  it("marks the window edited at once and writes once typing pauses", async () => {
    const s = new LocalFileSession(bridge, "a");
    setMarkdown(s.doc, "ab", "editor");
    expect(s.getState().dirty).toBe(true);
    expect(bridge.edited).toEqual([true]);
    setMarkdown(s.doc, "abc", "editor");
    vi.advanceTimersByTime(400);
    expect(bridge.writes).toEqual([]); // still typing
    await vi.advanceTimersByTimeAsync(200);
    expect(bridge.writes).toEqual(["abc"]); // one write, the latest text
    expect(s.getState().dirty).toBe(false);
    expect(bridge.edited).toEqual([true, false]);
  });

  it("writes again for an edit made while a write was in flight", async () => {
    let release: (() => void) | null = null;
    bridge.save = (content) =>
      new Promise((resolve) => {
        bridge.writes.push(content);
        release = () => resolve({ ok: true });
      });
    const s = new LocalFileSession(bridge, "");
    setMarkdown(s.doc, "one", "editor");
    await vi.advanceTimersByTimeAsync(500);
    expect(bridge.writes).toEqual(["one"]);
    setMarkdown(s.doc, "one two", "editor"); // during the write
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.writes).toEqual(["one", "one two"]);
    expect(s.getState().dirty).toBe(true); // the second write is still open
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.getState().dirty).toBe(false);
  });

  it("flushes on close without waiting out the pause", async () => {
    const s = new LocalFileSession(bridge, "");
    setMarkdown(s.doc, "late", "editor");
    const result = await bridge.closeWindow();
    expect(result).toEqual({ ok: true });
    expect(bridge.writes).toEqual(["late"]);
  });

  it("keeps a failed write visible and stays dirty", async () => {
    bridge.failWith = "EACCES: permission denied";
    const s = new LocalFileSession(bridge, "");
    setMarkdown(s.doc, "x", "editor");
    await vi.advanceTimersByTimeAsync(500);
    expect(s.getState()).toMatchObject({ dirty: true, saveError: "EACCES: permission denied" });
    bridge.failWith = null;
    await s.flush(); // Retry
    expect(bridge.writes).toEqual(["x"]);
    expect(s.getState()).toMatchObject({ dirty: false, saveError: null });
  });

  it("reseeds from disk when nothing is unsaved here", () => {
    const s = new LocalFileSession(bridge, "old");
    bridge.diskNow("new");
    expect(getMarkdown(s.doc)).toBe("new");
    expect(s.getState().dirty).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(bridge.writes).toEqual([]); // the reseed is not an edit
  });

  it("ignores a change on disk that matches what it has (its own write echoed)", async () => {
    const s = new LocalFileSession(bridge, "");
    setMarkdown(s.doc, "same", "editor");
    await vi.advanceTimersByTimeAsync(500);
    bridge.diskNow("same");
    expect(s.getState().external).toBeNull();
  });

  it("holds an external change, and its own writes, while there are unsaved edits", async () => {
    const s = new LocalFileSession(bridge, "base");
    setMarkdown(s.doc, "base mine", "editor");
    bridge.diskNow("base theirs");
    expect(getMarkdown(s.doc)).toBe("base mine"); // kept
    expect(s.getState().external).toEqual({ content: "base theirs" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bridge.writes).toEqual([]); // nothing overwrites theirs unasked
    // closing now is refused, so the shell can ask rather than lose one copy
    expect((await bridge.closeWindow()).ok).toBe(false);
  });

  it("reload takes the disk copy and clears the unsaved state", async () => {
    const s = new LocalFileSession(bridge, "base");
    setMarkdown(s.doc, "base mine", "editor");
    bridge.diskNow("base theirs");
    s.reloadFromDisk();
    expect(getMarkdown(s.doc)).toBe("base theirs");
    expect(s.getState()).toMatchObject({ dirty: false, external: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bridge.writes).toEqual([]);
  });

  it("keep-mine writes the local edits over the disk copy", async () => {
    const s = new LocalFileSession(bridge, "base");
    setMarkdown(s.doc, "base mine", "editor");
    bridge.diskNow("base theirs");
    s.keepMine();
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.writes).toEqual(["base mine"]);
    expect(s.getState()).toMatchObject({ dirty: false, external: null });
  });

  it("reports a file that can no longer be read without blanking the text", () => {
    const s = new LocalFileSession(bridge, "x");
    bridge.changed?.({ path: "/p/a.md", dir: "/p", name: "a.md", content: "", error: "ENOENT" });
    expect(s.getState().fileError).toBe("ENOENT");
    expect(getMarkdown(s.doc)).toBe("x");
  });
});
