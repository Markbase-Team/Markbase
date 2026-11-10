import { describe, it, expect } from "vitest";
import { createDoc } from "../src/logic/crdt";
import { snapshot } from "../src/logic/sync";
import { SyncSession, type DocStore, type DocPubSub } from "../src/logic/transport";
import { VaultSync, type VaultSyncFs } from "../src/logic/vault-sync";

// In-memory backends so the whole local-vault lifecycle is testable with no
// Supabase and no real filesystem.
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
  publish(id: string, update: Uint8Array): void {
    for (const h of this.subs.get(id) ?? []) h(update);
  }
  subscribe(id: string, onUpdate: (u: Uint8Array) => void): () => void {
    let set = this.subs.get(id);
    if (!set) this.subs.set(id, (set = new Set()));
    set.add(onUpdate);
    return () => set!.delete(onUpdate);
  }
}

class MemFs implements VaultSyncFs {
  files = new Map<string, string>();
  read(p: string): string | null {
    return this.files.has(p) ? this.files.get(p)! : null;
  }
  write(p: string, content: string): void {
    this.files.set(p, content);
  }
}

describe("VaultSync: open reconciles cloud and disk", () => {
  it("materializes the file from the cloud when disk is empty", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    // Pre-seed the cloud with a document.
    await store.save("d1", snapshot(createDoc("# Hello\n\nworld\n")));

    const fs = new MemFs();
    const vs = await VaultSync.open("d1", "Hello.md", store, bus, fs);
    expect(fs.read("Hello.md")).toBe("# Hello\n\nworld\n");
    vs.close();
  });

  it("pushes an offline disk edit up to the cloud (no duplication)", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    await store.save("d2", snapshot(createDoc("base line\n")));

    const fs = new MemFs();
    fs.write("Doc.md", "base line\noffline addition\n"); // edited while worker was down
    const vs = await VaultSync.open("d2", "Doc.md", store, bus, fs);

    // The CRDT holds the merged result exactly once (no duplicated "base line").
    expect(vs.markdown()).toBe("base line\noffline addition\n");
    // And a fresh session loading from the store sees it too.
    const fresh = await SyncSession.open("d2", createDoc(), store, bus);
    const { getMarkdown } = await import("../src/logic/crdt");
    expect(getMarkdown(fresh.doc)).toContain("offline addition");
    fresh.close();
    vs.close();
  });
});

describe("VaultSync: two machines converge over the bus", () => {
  it("a local file edit lands on another machine's disk", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    await store.save("d3", snapshot(createDoc("# Doc\n")));

    const fsA = new MemFs(), fsB = new MemFs();
    const a = await VaultSync.open("d3", "A.md", store, bus, fsA);
    const b = await VaultSync.open("d3", "B.md", store, bus, fsB);

    fsA.write("A.md", "# Doc\n\nfrom A\n");
    a.fileChanged();

    expect(fsB.read("B.md")).toContain("from A");
    a.close();
    b.close();
  });

  it("a cloud edit flushes to this machine's disk file", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    await store.save("d4", snapshot(createDoc("start\n")));

    const fsA = new MemFs(), fsB = new MemFs();
    const a = await VaultSync.open("d4", "A.md", store, bus, fsA);
    const b = await VaultSync.open("d4", "B.md", store, bus, fsB);

    // B edits its file; A (a different machine) should see it written to disk.
    fsB.write("B.md", "start\nfrom B\n");
    b.fileChanged();

    expect(fsA.read("A.md")).toContain("from B");
    a.close();
    b.close();
  });
});

describe("VaultSync: no echo loop", () => {
  it("our own flush, re-read from disk, is absorbed (not re-applied)", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    await store.save("d5", snapshot(createDoc("x\n")));
    const fsA = new MemFs(), fsB = new MemFs();
    const a = await VaultSync.open("d5", "A.md", store, bus, fsA);
    const b = await VaultSync.open("d5", "B.md", store, bus, fsB);

    fsB.write("B.md", "x\ny\n");
    b.fileChanged();
    const afterFirst = fsA.read("A.md");
    // Simulate the watcher firing on A for the write we just made — must no-op.
    a.fileChanged();
    expect(fsA.read("A.md")).toBe(afterFirst);
    expect(a.markdown()).toBe(b.markdown());
    a.close();
    b.close();
  });
});

// A document created through the API — which is how agents, the MCP createDoc
// tool and the CLI all make documents — has its markdown in the `documents` row
// and NO CRDT at all. The CRDT is only born when something opens the doc.
//
// VaultSync always started from an empty doc and hydrated from the cloud, so for
// those documents it materialized an EMPTY FILE, and the watcher then pushed that
// emptiness up as the CRDT. One-way: the web only seeds when the CRDT is null, so
// once the daemon wrote an empty one the document opened empty in the browser too
// and the row's content was stranded.
//
// The web never had this bug — openEditorDoc seeds from the server-rendered
// markdown when store.load() is null. The daemon just needed the same rule.
describe("VaultSync seeding (a doc whose content is in the row, not the CRDT)", () => {
  it("seeds from the document's markdown when the cloud has no CRDT yet", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    // No CRDT for this doc — exactly what POST /api/v1/docs leaves behind.
    const vs = await VaultSync.open("d1", "roadmap.md", store, bus, fs, undefined, "# Roadmap\n");

    expect(vs.markdown()).toBe("# Roadmap\n");
    expect(fs.read("roadmap.md")).toBe("# Roadmap\n"); // NOT an empty file
    // and the seed reached the cloud, so the browser hydrates the same content
    expect(await store.load("d1")).not.toBeNull();
    vs.close();
  });

  // The seed is a fallback, never an override: once a CRDT exists it is the
  // truth, and re-seeding would insert the row's stale content on top of it.
  it("ignores the seed when the cloud already has a CRDT", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d1", snapshot(createDoc("# The real, edited content\n")));

    const vs = await VaultSync.open("d1", "roadmap.md", store, bus, fs, undefined, "# Stale row\n");
    expect(vs.markdown()).toBe("# The real, edited content\n");
    expect(fs.read("roadmap.md")).toBe("# The real, edited content\n");
    vs.close();
  });

  it("still works with no seed at all (an empty document is legitimately empty)", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    const vs = await VaultSync.open("d1", "empty.md", store, bus, fs);
    expect(vs.markdown()).toBe("");
    vs.close();
  });

  // A local file already on disk still wins over the row's content: it's the
  // user's most recent writing, and the seed is only there to fill a void.
  it("does not let the seed clobber a file already on disk", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    fs.write("roadmap.md", "# Written locally, never uploaded\n");
    const vs = await VaultSync.open("d1", "roadmap.md", store, bus, fs, undefined, "# Row\n");
    expect(vs.markdown()).toContain("Written locally");
    vs.close();
  });
});
