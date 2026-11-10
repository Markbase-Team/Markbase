import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { VaultDoc } from "../src/logic/vault";

// A tiny in-memory "disk" so tests are deterministic (no real fs/chokidar).
class FakeDisk {
  content: string | null;
  writes = 0;
  constructor(initial: string | null = null) {
    this.content = initial;
  }
  write(c: string): void {
    this.content = c;
    this.writes++;
  }
}

// Wire a VaultDoc to a FakeDisk the way the real watcher would: flush writes to
// disk, and every disk write is echoed back to the doc (simulating the watcher
// firing on our own write) so the loop-guard is actually exercised.
function bind(v: VaultDoc, disk: FakeDisk) {
  const flush = () => {
    const r = v.flushToDisk();
    if (r.wrote) {
      disk.write(r.content);
      v.applyFileContent(r.content); // the watcher echo — must be a no-op
    }
    return r;
  };
  return { flush };
}

describe("VaultDoc: external edit intake", () => {
  it("an external file edit flows into the CRDT", () => {
    const v = new VaultDoc("# Old\n");
    const r = v.applyFileContent("# New\n\nbody\n");
    expect(r.changed).toBe(true);
    expect(v.markdown()).toBe("# New\n\nbody\n");
  });

  it("preserves an image verbatim through disk intake and a later flush", () => {
    const disk = new FakeDisk();
    const v = new VaultDoc();
    // agent wrote the file; the watcher reads it in
    disk.write("text ![alt](image.png) more\n");
    v.applyFileContent(disk.content!);
    expect(v.markdown()).toBe("text ![alt](image.png) more\n");
    // an editor/cloud edit advances the CRDT; flush writes it back to disk
    const t = v.doc.getText("source");
    v.doc.transact(() => t.insert(t.length, "and a tail\n"));
    const r = v.flushToDisk();
    disk.write(r.content);
    expect(disk.content).toContain("![alt](image.png)"); // image survived
    expect(disk.content).toContain("and a tail");
  });

  it("first cloud pull to an empty disk writes the file", () => {
    const cloud = new VaultDoc("# From cloud\n\nbody\n");
    const v = new VaultDoc(); // empty — nothing on disk yet
    v.applyRemoteUpdate(cloud.encodeUpdate());
    const r = v.flushToDisk();
    expect(r.wrote).toBe(true);
    expect(r.content).toBe("# From cloud\n\nbody\n");
  });
});

describe("VaultDoc: the write-back loop guard", () => {
  it("flushing a CRDT edit then echoing our own write is a no-op (no phantom loop)", () => {
    const disk = new FakeDisk();
    const v = new VaultDoc("# Doc\n");
    const { flush } = bind(v, disk);
    // a CRDT-side edit (cloud or editor) — not a file edit
    const t = v.doc.getText("source");
    v.doc.transact(() => t.insert(t.length, "\nedited\n"));
    flush(); // writes once; the echoed applyFileContent must not re-trigger a write
    const r2 = v.flushToDisk();
    expect(r2.wrote).toBe(false);
    expect(disk.writes).toBe(1); // exactly one write, no loop
  });

  it("a file event identical to current state changes nothing", () => {
    const v = new VaultDoc("stable\n");
    const r = v.applyFileContent("stable\n");
    expect(r.changed).toBe(false);
  });
});

describe("VaultDoc: divergence (both sides changed)", () => {
  it("merges a stale file edit with a concurrent cloud edit — neither is lost", () => {
    const base = "# Title\n\nAlpha.\n\nBeta.\n";
    // Two clients sharing history.
    const a = new VaultDoc(base);
    const b = new VaultDoc();
    b.applyRemoteUpdate(a.encodeUpdate());
    // Hydrated from the cloud: that state is b's base, as VaultSync.open does.
    // (Without it b's first file edit is a merge against an empty base — a
    // conflict, which used to be papered over with markers.)
    b.markSynced();
    // Cloud edit arrives at `a` (edits Beta), flushed into a's CRDT via Yjs.
    b.applyFileContent("# Title\n\nAlpha.\n\nBeta by cloud.\n");
    a.applyRemoteUpdate(b.encodeUpdate());
    // Meanwhile a's local FILE was edited (edits Alpha) but is stale re: cloud.
    const r = a.applyFileContent("# Title\n\nAlpha by file.\n\nBeta.\n");
    expect(r.merged).toBe(true);
    expect(a.markdown()).toContain("Alpha by file"); // local file edit kept
    expect(a.markdown()).toContain("Beta by cloud"); // cloud edit NOT clobbered
  });

  it("on a conflict keeps the cloud's text and hands the file's back, with no markers", () => {
    const v = new VaultDoc("one line\n");
    // advance the CRDT out-of-band so ours != lastSynced without moving lastSynced
    const raw = v.doc.getText("source");
    v.doc.transact(() => {
      raw.delete(0, raw.length);
      raw.insert(0, "crdt version\n");
    });
    const r = v.applyFileContent("file version\n");
    expect(r.merged).toBe(true);
    expect(r.conflict).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.rejected).toBe("file version\n");
    // The document is the cloud's; markers never enter it (markdown would read
    // them as a heading and retitle the document — seen 2026-11-08).
    expect(v.markdown()).toBe("crdt version\n");
    expect(v.markdown()).not.toContain("<<<<<<<");
    // Nothing to flush: the base IS the cloud's text now. Putting it back on
    // the file is the caller's step (VaultSync writes it, with the copy).
    expect(v.flushToDisk().wrote).toBe(false);
  });
});

describe("VaultDoc: delete safety", () => {
  it("a file-removed event restores from the CRDT rather than wiping it", () => {
    const v = new VaultDoc("# Important\n\ncontent\n");
    const r = v.onFileRemoved();
    expect(r.wrote).toBe(true);
    expect(r.content).toBe("# Important\n\ncontent\n"); // restored, not empty
    expect(v.markdown()).toBe("# Important\n\ncontent\n");
  });
});

describe("VaultDoc: two vaults over the same doc converge", () => {
  it("file edits on two machines converge via Yjs updates", () => {
    const a = new VaultDoc("# Shared\n\nX.\n\nY.\n");
    const b = new VaultDoc();
    b.applyRemoteUpdate(a.encodeUpdate());
    b.markSynced(); // hydrated from the cloud: that is b's base (see above)
    const sa = Y.encodeStateVector(a.doc), sb = Y.encodeStateVector(b.doc);
    a.applyFileContent("# Shared\n\nX edited on A.\n\nY.\n");
    b.applyFileContent("# Shared\n\nX.\n\nY edited on B.\n");
    a.applyRemoteUpdate(Y.encodeStateAsUpdate(b.doc, sa));
    b.applyRemoteUpdate(Y.encodeStateAsUpdate(a.doc, sb));
    expect(a.markdown()).toBe(b.markdown());
    expect(a.markdown()).toContain("edited on A");
    expect(a.markdown()).toContain("edited on B");
  });
});

// A Map-backed VaultFs for deterministic folder tests.
class FakeFs {
  files = new Map<string, string>();
  trashed: string[] = [];
  writes = 0;
  read(p: string): string | null {
    return this.files.has(p) ? this.files.get(p)! : null;
  }
  write(p: string, c: string): void {
    this.files.set(p, c);
    this.writes++;
  }
  trash(p: string): void {
    this.files.delete(p);
    this.trashed.push(p);
  }
}

import { VaultFolder } from "../src/logic/vault";

describe("VaultFolder orchestration", () => {
  it("adopts a new markdown file and routes files independently", () => {
    const fs = new FakeFs();
    const vf = new VaultFolder(fs);
    fs.files.set("a.md", "# A\n");
    fs.files.set("b.md", "# B\n");
    vf.fileChanged("a.md");
    vf.fileChanged("b.md");
    expect(vf.paths().sort()).toEqual(["a.md", "b.md"]);
    expect(vf.get("a.md")!.markdown()).toBe("# A\n");
    expect(vf.get("b.md")!.markdown()).toBe("# B\n");
  });

  it("absorbs an edit to a tracked file", () => {
    const fs = new FakeFs();
    const vf = new VaultFolder(fs);
    fs.files.set("d.md", "old\n");
    vf.fileChanged("d.md");
    fs.files.set("d.md", "new ![img](x.png)\n"); // agent rewrote it
    vf.fileChanged("d.md");
    expect(vf.get("d.md")!.markdown()).toBe("new ![img](x.png)\n");
  });

  it("restores a removed file from the CRDT instead of losing it", () => {
    const fs = new FakeFs();
    const vf = new VaultFolder(fs);
    fs.files.set("keep.md", "# Precious\n\nbody\n");
    vf.fileChanged("keep.md");
    fs.files.delete("keep.md"); // errant delete
    vf.fileRemoved("keep.md");
    expect(fs.read("keep.md")).toBe("# Precious\n\nbody\n"); // restored
  });

  it("flush writes only CRDT-ahead docs, and the echo doesn't loop", () => {
    const fs = new FakeFs();
    const vf = new VaultFolder(fs);
    fs.files.set("c.md", "# C\n");
    vf.fileChanged("c.md"); // in sync, disk == CRDT
    // a remote/cloud update advances c.md's CRDT
    const cloud = new VaultDoc("# C\n");
    const t = cloud.doc.getText("source");
    cloud.doc.transact(() => t.insert(t.length, "\ncloud line\n"));
    vf.applyRemote("c.md", cloud.encodeUpdate());
    const written = vf.flush();
    expect(written).toEqual(["c.md"]);
    expect(fs.read("c.md")).toContain("cloud line");
    // simulate the watcher echo of our own write, then flush again: no more writes
    const w = fs.writes;
    vf.fileChanged("c.md");
    expect(vf.flush()).toEqual([]);
    expect(fs.writes).toBe(w); // no phantom loop
  });

  it("two folders on the same file converge via remote updates", () => {
    const fsA = new FakeFs(), fsB = new FakeFs();
    const A = new VaultFolder(fsA), B = new VaultFolder(fsB);
    fsA.files.set("s.md", "# S\n\nP.\n\nQ.\n");
    A.fileChanged("s.md");
    B.applyRemote("s.md", A.get("s.md")!.encodeUpdate());
    B.flush(); // B writes the pulled doc to its disk — now B's last-synced == base
    const sa = Y.encodeStateVector(A.get("s.md")!.doc);
    const sb = Y.encodeStateVector(B.get("s.md")!.doc);
    fsA.files.set("s.md", "# S\n\nP by A.\n\nQ.\n"); A.fileChanged("s.md");
    fsB.files.set("s.md", "# S\n\nP.\n\nQ by B.\n"); B.fileChanged("s.md");
    B.applyRemote("s.md", Y.encodeStateAsUpdate(A.get("s.md")!.doc, sb));
    A.applyRemote("s.md", Y.encodeStateAsUpdate(B.get("s.md")!.doc, sa));
    expect(A.get("s.md")!.markdown()).toBe(B.get("s.md")!.markdown());
    expect(A.get("s.md")!.markdown()).toContain("P by A");
    expect(A.get("s.md")!.markdown()).toContain("Q by B");
  });
});
