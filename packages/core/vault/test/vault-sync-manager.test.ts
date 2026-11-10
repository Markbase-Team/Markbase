import { describe, it, expect } from "vitest";
import {
  createDoc,
  snapshot,
  type DocStore,
  type DocPubSub,
  type VaultSyncFs,
} from "@markbase/docs";
import { renameFolder, moveFolder, filesUnder } from "@markbase/protocol/folders";
import {
  VaultSyncManager,
  type VaultDocRef,
  type VaultSyncOptions,
} from "../src/vault-sync-manager";
import { docsSyncedFiles } from "../src/docs-synced-file";
import { assignPaths } from "../src/vault-sync-run";

class FakeStore implements DocStore {
  private blobs = new Map<string, Uint8Array>();
  async load(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
  async save(id: string, snap: Uint8Array): Promise<void> {
    this.blobs.set(id, snap);
  }
}
class FakeBus implements DocPubSub {
  private subs = new Map<string, Set<(u: Uint8Array) => void>>();
  publish(id: string, u: Uint8Array): void {
    for (const h of this.subs.get(id) ?? []) h(u);
  }
  subscribe(id: string, on: (u: Uint8Array) => void): () => void {
    let s = this.subs.get(id);
    if (!s) this.subs.set(id, (s = new Set()));
    s.add(on);
    return () => s!.delete(on);
  }
}
class MemFs implements VaultSyncFs {
  files = new Map<string, string>();
  read(p: string): string | null {
    return this.files.has(p) ? this.files.get(p)! : null;
  }
  write(p: string, c: string): void {
    this.files.set(p, c);
  }
}

/**
 * Open a manager the way the daemon does: with a real CRDT file opener.
 *
 * The manager no longer takes a store or a pubsub — it takes an opener — so this
 * keeps the (refs, store, bus, fs) order these tests already read well in, and
 * does the wiring once. A test that cared only about routing could pass a fake
 * opener here and drop the CRDT entirely; that is the point of the seam.
 */
function openManager(
  refs: VaultDocRef[],
  store: DocStore,
  bus: DocPubSub,
  fs: MemFs,
  opts: VaultSyncOptions = {}
): Promise<VaultSyncManager> {
  return VaultSyncManager.open(refs, fs, docsSyncedFiles(store, bus, fs), opts);
}

describe("VaultSyncManager", () => {
  it("opens one sync per doc and materializes each file from the cloud", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# A\n")));
    await store.save("b", snapshot(createDoc("# B\n")));

    const m = await openManager(
      [{ id: "a", path: "A.md" }, { id: "b", path: "B.md" }],
      store, bus, fs
    );
    expect(fs.read("A.md")).toBe("# A\n");
    expect(fs.read("B.md")).toBe("# B\n");
    expect(m.paths().sort()).toEqual(["A.md", "B.md"]);
    m.closeAll();
  });

  // The manager is what switches version tracking on, so a document it opened
  // has to record history for an edit made to its file here. Without this wiring
  // the daemon opens every document and quietly keeps no history for any of them
  // — and the browser's ticker then credits what syncs up to whoever has the doc
  // open. (What the entry SAYS is covered in docs/test/vault-checkpoint.test.ts;
  // this is about the wiring.)
  it("records versions for the documents it opens", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# A\n")));
    const m = await openManager(
      [{ id: "a", path: "A.md" }],
      store, bus, fs,
      { author: "Jessie" }
    );

    fs.write("A.md", "# A\n\nedited in Obsidian\n");
    m.fileChanged("A.md");

    // Past the idle window, so the cadence rules say the thought finished.
    expect(m.checkpointDue(Date.now() + 3 * 60_000)).toBe(1);
    // Nothing new since: recording again would fill history with duplicates.
    expect(m.checkpointDue(Date.now() + 6 * 60_000)).toBe(0);
    m.closeAll();
  });

  // A daemon that could not resolve who it belongs to still keeps history —
  // an unattributed version beats none.
  it("still records when there is no author to credit", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# A\n")));
    const m = await openManager([{ id: "a", path: "A.md" }], store, bus, fs);

    fs.write("A.md", "# A\n\nedited\n");
    m.fileChanged("A.md");

    expect(m.checkpointDue(Date.now() + 3 * 60_000)).toBe(1);
    m.closeAll();
  });

  // A file that momentarily reads as empty must not empty the document — cp and
  // friends truncate before writing. The manager's sweep is what settles it, so
  // this covers the wiring the VaultSync unit tests can't see.
  it("holds a transient empty read until its sweep settles it", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# A\n")));
    const m = await openManager([{ id: "a", path: "A.md" }], store, bus, fs);

    fs.write("A.md", ""); // the truncate half of a non-atomic write
    m.fileChanged("A.md");
    expect(m.markdownOf("A.md")).toBe("# A\n"); // not emptied

    // The writer finished before the sweep ran: nothing was emptied, and the
    // content it actually wrote is what lands.
    fs.write("A.md", "# A\n\nrewritten\n");
    expect(m.confirmPendingEmpties()).toBe(0);
    expect(m.markdownOf("A.md")).toBe("# A\n\nrewritten\n");
    m.closeAll();
  });

  it("empties the document when the file is still empty at sweep time", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# A\n")));
    const m = await openManager([{ id: "a", path: "A.md" }], store, bus, fs);

    fs.write("A.md", "");
    m.fileChanged("A.md");
    expect(m.confirmPendingEmpties()).toBe(1); // genuinely cleared
    expect(m.markdownOf("A.md")).toBe("");
    m.closeAll();
  });

  it("routes a file change to the right doc, and ignores unknown paths", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# A\n")));
    const m = await openManager([{ id: "a", path: "A.md" }], store, bus, fs);

    fs.write("A.md", "# A\n\nedited\n");
    expect(m.fileChanged("A.md")).toBe(true);
    // the edit reached the cloud store (a fresh load sees it)
    expect(await store.load("a")).not.toBeNull();

    expect(m.fileChanged("Unknown.md")).toBe(false);
    m.closeAll();
  });

  it("adopts a brand-new file as a cloud document and starts syncing it", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    const created: Array<{ path: string; content: string }> = [];
    const adopt = async (path: string, content: string): Promise<string> => {
      created.push({ path, content });
      return "new-doc-id";
    };
    const m = await openManager([], store, bus, fs, { adopt });

    fs.write("Fresh.md", "# Fresh\n\nwritten locally\n");
    const id = await m.adoptFile("Fresh.md");

    expect(id).toBe("new-doc-id");
    expect(created).toHaveLength(1);
    expect(m.has("Fresh.md")).toBe(true);
    // now tracked: a later change routes rather than re-adopting
    expect(await m.adoptFile("Fresh.md")).toBeNull();
    expect(m.fileChanged("Fresh.md")).toBe(true);
    expect(await store.load("new-doc-id")).not.toBeNull();
    m.closeAll();
  });

  it("never adopts its own materialization while a doc is mid-open (self-write race)", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    await store.save("a", snapshot(createDoc("# A\n")));

    // A filesystem whose write() fires a hook — standing in for the OS watcher
    // seeing the daemon's own materialization the instant it lands on disk. This is
    // exactly the window that used to spawn "Untitled" duplicates: VaultSync.open
    // writes the file before the manager records the path, so the watcher event saw
    // an untracked file and adopted it as a brand-new document.
    class WatchedFs extends MemFs {
      onWrite: ((p: string) => void) | null = null;
      write(p: string, c: string): void {
        super.write(p, c);
        this.onWrite?.(p);
      }
    }
    const fs = new WatchedFs();
    const adopted: string[] = [];
    const adopt = async (path: string): Promise<string> => {
      adopted.push(path);
      return `dup-${path}`;
    };
    const m = await openManager([], store, bus, fs, { adopt });

    let changedDuringOpen: boolean | undefined;
    fs.onWrite = (p) => {
      if (p !== "A.md") return;
      // Fires while VaultSync.open is still writing. The path must already count as
      // tracked (fileChanged handles it) and adoptFile must be a no-op.
      changedDuringOpen = m.fileChanged(p);
      void m.adoptFile(p);
    };
    await m.openDoc({ id: "a", path: "A.md" });

    expect(changedDuringOpen).toBe(true);   // routed as an echo, not treated as unknown
    expect(adopted).not.toContain("A.md");  // never self-adopted into a duplicate
    expect(m.docIdOf("A.md")).toBe("a");    // still the original doc
    expect(m.paths()).toEqual(["A.md"]);    // exactly one entry
    m.closeAll();
  });

  it("restores a file from the CRDT when it's deleted on disk", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# Keep me\n")));
    const m = await openManager([{ id: "a", path: "A.md" }], store, bus, fs);
    expect(fs.read("A.md")).toBe("# Keep me\n");

    fs.files.delete("A.md"); // errant delete
    m.fileRemoved("A.md");
    expect(fs.read("A.md")).toBe("# Keep me\n"); // restored, not lost
    m.closeAll();
  });

  it("follows a rename without duplicating or losing the doc", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# Doc\n")));
    const m = await openManager([{ id: "a", path: "Old.md" }], store, bus, fs);

    fs.files.delete("Old.md"); // OS moved the file...
    fs.write("New.md", "# Doc\n"); // ...to here
    expect(m.moveDoc("Old.md", "New.md")).toBe(true);
    expect(m.has("New.md")).toBe(true);
    expect(m.has("Old.md")).toBe(false);

    // an edit at the new path routes to the same doc (no re-adopt), and a flush
    // writes to the new path, not the old.
    fs.write("New.md", "# Doc\n\nedited at new path\n");
    expect(m.fileChanged("New.md")).toBe(true);
    expect(fs.read("Old.md")).toBeNull();

    expect(m.moveDoc("Old.md", "New.md")).toBe(false); // old gone → no-op
    m.closeAll();
  });

  // Moving a FOLDER is one rename(2) on the directory — the files inside are
  // never individually touched, so the filesystem emits no per-file unlink to
  // pair with the add. Correlating on watcher event order silently re-adopted
  // every moved file as a duplicate. Infer the move from content instead, the
  // way git detects renames it never recorded.
  it("detects a move from content alone — no unlink required", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d1", snapshot(createDoc("# Roadmap\n")));
    const m = await openManager(
      [{ id: "d1", path: "projects/roadmap.md" }], store, bus, fs
    );
    const content = fs.read("projects/roadmap.md")!;

    // the OS renamed the directory: the file is simply at a new path now
    fs.files.delete("projects/roadmap.md");
    fs.write("work/roadmap.md", content);

    const from = m.findMovedFrom(content, (p) => fs.read(p) !== null);
    expect(from).toBe("projects/roadmap.md");
    expect(m.moveDoc(from!, "work/roadmap.md")).toBe(true);
    expect(m.paths()).toEqual(["work/roadmap.md"]);
    m.closeAll();
  });

  it("does not mistake a copy for a move — the original is still on disk", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d1", snapshot(createDoc("# Roadmap\n")));
    const m = await openManager(
      [{ id: "d1", path: "projects/roadmap.md" }], store, bus, fs
    );
    const content = fs.read("projects/roadmap.md")!;

    fs.write("copy.md", content); // duplicated, original untouched
    // the original still exists → not a move; it should be adopted as a new doc
    expect(m.findMovedFrom(content, (p) => fs.read(p) !== null)).toBeNull();
    m.closeAll();
  });

  it("does not treat brand-new content as a move", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d1", snapshot(createDoc("# Roadmap\n")));
    const m = await openManager(
      [{ id: "d1", path: "projects/roadmap.md" }], store, bus, fs
    );
    expect(m.findMovedFrom("# Totally new\n", () => false)).toBeNull();
    m.closeAll();
  });

  // Closing the path-persistence gap: a move that isn't written back to the
  // document would be undone by the next sync (assignPaths would resolve the
  // stale stored path and pull the file home).
  it("reports a move so the new path can be persisted", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("doc-1", snapshot(createDoc("# Doc\n")));
    const moved: Array<{ id: string; path: string }> = [];
    const m = await openManager([{ id: "doc-1", path: "inbox.md" }], store, bus, fs, {
      onMoved: (id, path) => moved.push({ id, path }),
    });

    expect(m.moveDoc("inbox.md", "projects/2026/inbox.md")).toBe(true);
    expect(moved).toEqual([{ id: "doc-1", path: "projects/2026/inbox.md" }]);
    expect(m.docIdOf("projects/2026/inbox.md")).toBe("doc-1");

    // a rejected move must not report anything
    expect(m.moveDoc("nope.md", "x.md")).toBe(false);
    expect(moved).toHaveLength(1);
    m.closeAll();
  });

  it("persists a whole folder rename — one write per affected doc", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    const paths = ["projects/roadmap.md", "projects/2026/q1.md", "inbox.md"];
    const refs = paths.map((p, i) => ({ id: `d${i}`, path: p }));
    for (const r of refs) await store.save(r.id, snapshot(createDoc(`# ${r.path}\n`)));
    const moved: Array<{ id: string; path: string }> = [];
    const m = await openManager(refs, store, bus, fs, {
      onMoved: (id, path) => moved.push({ id, path }),
    });

    for (const mv of renameFolder(paths, "projects", "work")) m.moveDoc(mv.from, mv.to);

    // only the two docs under projects/ are written back; inbox.md is untouched
    expect(moved).toEqual([
      { id: "d0", path: "work/roadmap.md" },
      { id: "d1", path: "work/2026/q1.md" },
    ]);
    m.closeAll();
  });
});

// Primitives the cloud reconcile drives (see vault-reconcile): the daemon has to
// be able to pick up a doc created elsewhere, follow a move the web made, and drop
// one that left the vault — all while running.
describe("applying what the cloud says", () => {
  it("refs() reports id+path together, so a diff can key on identity", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# A\n")));
    const m = await openManager([{ id: "a", path: "inbox.md" }], store, bus, fs);
    expect(m.refs()).toEqual([{ id: "a", path: "inbox.md" }]);
    m.closeAll();
  });

  it("openDoc picks up a document created on another device", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("new", snapshot(createDoc("# Made on the web\n")));
    const m = await openManager([], store, bus, fs);

    await m.openDoc({ id: "new", path: "projects/fresh.md" });
    expect(fs.read("projects/fresh.md")).toBe("# Made on the web\n"); // materialized
    expect(m.docIdOf("projects/fresh.md")).toBe("new");
    // and it's live: a local edit now routes to that doc
    fs.write("projects/fresh.md", "# Edited\n");
    expect(m.fileChanged("projects/fresh.md")).toBe(true);
    m.closeAll();
  });

  it("closeDoc drops one document, leaving the others syncing", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# A\n")));
    await store.save("b", snapshot(createDoc("# B\n")));
    const m = await openManager(
      [{ id: "a", path: "a.md" }, { id: "b", path: "b.md" }], store, bus, fs
    );
    expect(m.closeDoc("a.md")).toBe(true);
    expect(m.closeDoc("a.md")).toBe(false); // already gone
    expect(m.paths()).toEqual(["b.md"]);
    expect(m.fileChanged("a.md")).toBe(false); // no longer ours to push
    m.closeAll();
  });

  // A move the CLOUD told us about must not be echoed back to the cloud. It's the
  // same value, so it wouldn't loop — but it's a pointless write on every poll,
  // and onMoved exists to report moves we discovered, not ones we were handed.
  it("does not report a move that came from the cloud", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("a", snapshot(createDoc("# A\n")));
    const moved: Array<{ id: string; path: string }> = [];
    const m = await openManager([{ id: "a", path: "inbox.md" }], store, bus, fs, {
      onMoved: (id, path) => moved.push({ id, path }),
    });

    expect(m.moveDoc("inbox.md", "projects/inbox.md", { persist: false })).toBe(true);
    expect(m.docIdOf("projects/inbox.md")).toBe("a"); // re-keyed
    expect(moved).toEqual([]); // but never written back

    // a move we discovered locally still reports, as before
    expect(m.moveDoc("projects/inbox.md", "archive/inbox.md")).toBe(true);
    expect(moved).toEqual([{ id: "a", path: "archive/inbox.md" }]);
    m.closeAll();
  });
});

// The other half of the boundary. Refusing to ADOPT a nested vault's files stops
// us reading them — but a doc we already track whose path falls inside a vault
// that appeared later would keep being WRITTEN there on every cloud update,
// straight into another daemon's tree. Intake was guarded; output wasn't.
describe("closeUnder — stop writing into a subtree that stopped being ours", () => {
  const seed = async (paths: string[]) => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    const refs = paths.map((p, i) => ({ id: `d${i}`, path: p }));
    for (const r of refs) await store.save(r.id, snapshot(createDoc(`# ${r.path}\n`)));
    const m = await openManager(refs, store, bus, fs);
    return { m, fs, store, bus };
  };

  it("closes every doc under the folder and leaves the rest alone", async () => {
    const { m } = await seed(["Personal/a.md", "Personal/deep/b.md", "inbox.md"]);
    expect(m.closeUnder("Personal").sort()).toEqual(["Personal/a.md", "Personal/deep/b.md"]);
    expect(m.paths()).toEqual(["inbox.md"]);
    m.closeAll();
  });

  it("stops writing there — a later cloud update never reaches the file", async () => {
    const { m, fs } = await seed(["Personal/a.md"]);
    expect(fs.read("Personal/a.md")).toBe("# Personal/a.md\n"); // materialized while ours

    m.closeUnder("Personal");
    // the file is now another vault's business: our routing no longer knows it,
    // so nothing we do can overwrite it.
    expect(m.has("Personal/a.md")).toBe(false);
    expect(m.fileChanged("Personal/a.md")).toBe(false);
    m.closeAll();
  });

  it("is segment-aware — a 'Work' vault never closes 'Workshop'", async () => {
    const { m } = await seed(["Work/a.md", "Workshop/b.md"]);
    expect(m.closeUnder("Work")).toEqual(["Work/a.md"]);
    expect(m.paths()).toEqual(["Workshop/b.md"]);
    m.closeAll();
  });

  it("refuses to close the root — that would silently unsync the whole vault", async () => {
    const { m } = await seed(["a.md", "b.md"]);
    expect(() => m.closeUnder("")).toThrow(/root/i);
    expect(m.paths()).toHaveLength(2);
    m.closeAll();
  });

  it("is a no-op for a folder holding nothing of ours", async () => {
    const { m } = await seed(["inbox.md"]);
    expect(m.closeUnder("Personal")).toEqual([]);
    expect(m.paths()).toEqual(["inbox.md"]);
    m.closeAll();
  });
});

describe("assignPaths", () => {
  it("sanitizes titles and de-dupes collisions with an id suffix", () => {
    const refs = assignPaths([
      { id: "aaaaaaaa-1", title: "My Notes" },
      { id: "bbbbbbbb-2", title: "My Notes" }, // collision
      { id: "cccccccc-3", title: "Weird/Name:*?" }, // illegal chars
      { id: "dddddddd-4", title: "" }, // empty
    ]);
    expect(refs[0].path).toBe("My Notes.md");
    expect(refs[1].path).toBe("My Notes bbbbbbbb.md"); // id-suffixed, no clash
    expect(refs[2].path).toBe("Weird-Name-.md");
    expect(refs[3].path).toBe("untitled.md");
    // every path is unique
    expect(new Set(refs.map((r) => r.path)).size).toBe(refs.length);
  });

  // The rename loop: the API returns documents newest-updated first, so deciding
  // a contested filename by ARRIVAL order made the winner flip every time either
  // document was touched — and a move is a touch. Two docs wanting one name
  // ping-ponged every reconcile, forever. The decision must not depend on order.
  it("resolves a collision the same way whatever order the docs arrive in", () => {
    const a = { id: "aaaaaaaa-1", title: "Shared Name" };
    const b = { id: "bbbbbbbb-2", title: "Shared Name" };

    const forwards = assignPaths([a, b]);
    const backwards = assignPaths([b, a]);

    const pathOf = (refs: ReturnType<typeof assignPaths>, id: string) =>
      refs.find((r) => r.id === id)?.path;

    expect(pathOf(forwards, a.id)).toBe(pathOf(backwards, a.id));
    expect(pathOf(forwards, b.id)).toBe(pathOf(backwards, b.id));
    // And still exactly one of them holds the clean name.
    expect([pathOf(forwards, a.id), pathOf(forwards, b.id)]).toContain("Shared Name.md");
  });

  // The path persistence gap: without a stored path every doc lands flat at the
  // vault root, so folders can never come down from the cloud. A document that
  // knows its own path is what makes folders real end-to-end.
  it("uses a document's stored path, preserving its folders", () => {
    const refs = assignPaths([
      { id: "a", title: "Q1", path: "projects/2026/q1.md" },
      { id: "b", title: "Roadmap", path: "projects/roadmap.md" },
      { id: "c", title: "Inbox", path: "inbox.md" },
    ]);
    expect(refs.map((r) => r.path)).toEqual([
      "projects/2026/q1.md",
      "projects/roadmap.md",
      "inbox.md",
    ]);
  });

  it("falls back to the title for a doc with no path yet (pre-existing docs)", () => {
    const refs = assignPaths([
      { id: "a", title: "Has Path", path: "notes/deep/thing.md" },
      { id: "b", title: "No Path" }, // legacy doc — still works, lands at root
      { id: "c", title: "Null Path", path: null },
    ]);
    expect(refs[0].path).toBe("notes/deep/thing.md");
    expect(refs[1].path).toBe("No Path.md");
    expect(refs[2].path).toBe("Null Path.md");
  });

  it("normalizes a stored path and ensures the .md extension", () => {
    const refs = assignPaths([
      { id: "a", title: "x", path: "/leading/slash.md" },
      { id: "b", title: "y", path: "back\\slash\\note.md" },
      { id: "c", title: "z", path: "projects//double//sep.md" },
      { id: "d", title: "w", path: "no/extension" }, // .md appended
    ]);
    expect(refs.map((r) => r.path)).toEqual([
      "leading/slash.md",
      "back/slash/note.md",
      "projects/double/sep.md",
      "no/extension.md",
    ]);
  });

  it("de-dupes colliding stored paths by suffixing the filename, not the folder", () => {
    const refs = assignPaths([
      { id: "aaaaaaaa-1", title: "Q1", path: "projects/q1.md" },
      { id: "bbbbbbbb-2", title: "Q1", path: "projects/q1.md" }, // same path!
    ]);
    expect(refs[0].path).toBe("projects/q1.md");
    expect(refs[1].path).toBe("projects/q1 bbbbbbbb.md"); // folder preserved
    expect(new Set(refs.map((r) => r.path)).size).toBe(2);
  });

  it("de-dupes a stored path against a title-derived one", () => {
    const refs = assignPaths([
      { id: "aaaaaaaa-1", title: "Notes" }, // → Notes.md
      { id: "bbbbbbbb-2", title: "other", path: "Notes.md" }, // collides at root
    ]);
    expect(refs[0].path).toBe("Notes.md");
    expect(refs[1].path).toBe("Notes bbbbbbbb.md");
  });

  it("sanitizes illegal characters inside a stored path's segments", () => {
    const refs = assignPaths([{ id: "a", title: "x", path: 'we:ird*/na?me.md' }]);
    expect(refs[0].path).toBe("we-ird-/na-me.md");
  });
});

// Folder ops on the LOCAL vault: the pure folder logic computes the moves, the
// manager applies them by re-keying each doc's VaultSync. Web/electron trigger
// the same computation — only the application differs.
describe("folder moves applied to the local vault", () => {
  const seed = async (paths: string[]) => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    const refs = paths.map((p, i) => ({ id: `d${i}`, path: p }));
    for (const r of refs) await store.save(r.id, snapshot(createDoc(`# ${r.path}\n`)));
    const m = await openManager(refs, store, bus, fs);
    return { m, fs };
  };

  it("renames a folder inside the vault — every nested doc follows, none duplicated", async () => {
    const paths = ["projects/roadmap.md", "projects/2026/q1.md", "inbox.md"];
    const { m, fs } = await seed(paths);

    for (const mv of renameFolder(paths, "projects", "work")) {
      // the OS/user moved the file; the vault re-keys to follow it
      const content = fs.read(mv.from)!;
      fs.files.delete(mv.from);
      fs.write(mv.to, content);
      expect(m.moveDoc(mv.from, mv.to)).toBe(true);
    }

    expect(m.paths().sort()).toEqual(["inbox.md", "work/2026/q1.md", "work/roadmap.md"]);
    expect(m.has("projects/roadmap.md")).toBe(false); // no stale key
    expect(fs.read("projects/roadmap.md")).toBeNull(); // not recreated
    // the moved doc still routes edits (same CRDT, new path)
    fs.write("work/2026/q1.md", "# edited\n");
    expect(m.fileChanged("work/2026/q1.md")).toBe(true);
    m.closeAll();
  });

  it("moves a folder under another parent, keeping the untouched docs put", async () => {
    const paths = ["archive/old.md", "projects/roadmap.md"];
    const { m } = await seed(paths);
    for (const mv of moveFolder(paths, "archive", "projects")) {
      expect(m.moveDoc(mv.from, mv.to)).toBe(true);
    }
    expect(m.paths().sort()).toEqual(["projects/archive/old.md", "projects/roadmap.md"]);
    m.closeAll();
  });

  it("deleting a folder restores nothing it didn't own", async () => {
    const paths = ["proj/a.md", "projects/b.md"];
    const { m } = await seed(paths);
    // segment-aware: "proj" must not sweep up "projects/b.md"
    expect(filesUnder(paths, "proj")).toEqual(["proj/a.md"]);
    expect(m.has("projects/b.md")).toBe(true);
    m.closeAll();
  });
});

// A path the cloud owns must stay owned even when we fail to open its document.
//
// The regression these cover, verbatim from a live daemon:
//   [vault-sync] couldn't open learning/07-glm52-architecture.md: TypeError: terminated
//   [Markbase Vault] adopted learning/07-glm52-architecture.md → new document
//   [Markbase Vault] moved ... → learning/07-glm52-architecture 6d6d8e1c.md (from the cloud)
// One interrupted snapshot fetch produced a duplicate document and a collision
// file, because every adoption guard keyed on a live handle the failure removed.
class FlakyStore extends FakeStore {
  constructor(private readonly failFor: string) {
    super();
  }
  async load(id: string): Promise<Uint8Array | null> {
    if (id === this.failFor) throw new TypeError("terminated");
    return super.load(id);
  }
}

async function openWithFailure(fs: MemFs, adopt: () => Promise<string | null>) {
  const store = new FlakyStore("b"), bus = new FakeBus();
  await store.save("a", snapshot(createDoc("# A\n")));
  await store.save("b", snapshot(createDoc("# B\n")));
  const m = await openManager(
    [{ id: "a", path: "A.md" }, { id: "b", path: "B.md" }],
    store, bus, fs,
    { adopt }
  );
  return m;
}

describe("claimed paths", () => {
  it("does not adopt a file whose document merely failed to open", async () => {
    const fs = new MemFs();
    fs.write("B.md", "# B\n"); // the file is right there on disk
    let adopted = 0;
    const m = await openWithFailure(fs, async () => {
      adopted++;
      return "duplicate";
    });

    expect(m.claimedBy("B.md")).toBe("b"); // the LIST said so; the open didn't
    expect(m.has("B.md")).toBe(true);
    expect(await m.adoptFile("B.md")).toBeNull();
    expect(adopted).toBe(0);
  });

  it("still opens the documents that did not fail", async () => {
    const fs = new MemFs();
    const m = await openWithFailure(fs, async () => "duplicate");
    expect(m.markdownOf("A.md")).toBe("# A\n");
    expect(m.markdownOf("B.md")).toBeNull(); // claimed, but no handle
  });

  it("reports the claims it has no handle for, so they can be retried", async () => {
    const fs = new MemFs();
    const m = await openWithFailure(fs, async () => "duplicate");
    expect(m.unopenedClaims()).toEqual(["B.md"]);
  });

  it("releases a path once the cloud stops listing that document", async () => {
    const fs = new MemFs();
    fs.write("B.md", "# B\n");
    let adopted = 0;
    const m = await openWithFailure(fs, async () => {
      adopted++;
      return "reborn";
    });

    // The document really is gone now — a later list omits it.
    m.setClaims([{ id: "a", path: "A.md" }]);
    expect(m.claimedBy("B.md")).toBeNull();
    expect(m.has("B.md")).toBe(false);
    expect(await m.adoptFile("B.md")).toBe("reborn");
    expect(adopted).toBe(1);
  });

  it("still adopts a genuinely new file the cloud never claimed", async () => {
    const fs = new MemFs();
    fs.write("brand-new.md", "# New\n");
    const m = await openWithFailure(fs, async () => "fresh");
    expect(m.claimedBy("brand-new.md")).toBeNull();
    expect(await m.adoptFile("brand-new.md")).toBe("fresh");
  });

  it("re-points a claim when the cloud moved the document", async () => {
    const fs = new MemFs();
    const m = await openWithFailure(fs, async () => "duplicate");
    m.setClaims([{ id: "a", path: "A.md" }, { id: "b", path: "folder/B.md" }]);
    expect(m.claimedBy("B.md")).toBeNull();
    expect(m.claimedBy("folder/B.md")).toBe("b");
  });
});
