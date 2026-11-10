import { describe, it, expect } from "vitest";
import { createDoc, getMarkdown, setMarkdown } from "../src/logic/crdt";
import { snapshot } from "../src/logic/sync";
import { SyncSession, type DocStore, type DocPubSub } from "../src/logic/transport";
import { VaultSync, type VaultSyncFs, type VaultBaseStore } from "../src/logic/vault-sync";

// A document the person may read but not write (a viewer of a shared document
// — docs/shared-vault.md). The replica follows the cloud and writes the file;
// it never saves. An edit to the file is kept as a live fork: merged with what
// the cloud sends next, written back, never sent up — until the person becomes
// an editor, when one save lands all of it.

class FakeStore implements DocStore {
  readonly blobs = new Map<string, Uint8Array>();
  saves = 0;
  async load(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
  async save(id: string, snap: Uint8Array): Promise<void> {
    this.saves++;
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
class FakeBaseStore implements VaultBaseStore {
  bases = new Map<string, string>();
  load(id: string): string | null {
    return this.bases.has(id) ? this.bases.get(id)! : null;
  }
  save(id: string, base: string): void {
    this.bases.set(id, base);
  }
}

/** An editor elsewhere changes the document; the bus carries it live. */
async function cloudEdit(id: string, next: string, store: DocStore, bus: DocPubSub): Promise<void> {
  const s = await SyncSession.open(id, createDoc(), store, bus);
  setMarkdown(s.doc, next, "editor");
  await Promise.resolve();
  s.close();
}

const CLOUD = "# Plan\n\n- alpha\n- bravo\n";

async function openReadOnly(store: FakeStore, bus: FakeBus, fs: MemFs, base?: FakeBaseStore) {
  return VaultSync.open("d", "Ada/Plan.md", store, bus, fs, base, undefined, { readOnly: true });
}

describe("a read-only document", () => {
  it("materializes the file and follows the cloud, without ever saving", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d", snapshot(createDoc(CLOUD)));
    store.saves = 0;

    const vs = await openReadOnly(store, bus, fs);
    expect(fs.read("Ada/Plan.md")).toBe(CLOUD);
    expect(vs.readOnly).toBe(true);
    expect(vs.hasLocalEdits()).toBe(false);

    await cloudEdit("d", CLOUD + "- charlie\n", store, bus);
    expect(fs.read("Ada/Plan.md")).toBe(CLOUD + "- charlie\n");
    expect(vs.hasLocalEdits()).toBe(false);
    // The editor's own session saved once; the read-only replica never did.
    expect(store.saves).toBe(1);
    vs.close();
    expect(store.saves).toBe(1);
  });

  it("keeps an edit to the file as a fork: absorbed, never sent", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d", snapshot(createDoc(CLOUD)));
    store.saves = 0;

    const vs = await openReadOnly(store, bus, fs);
    fs.write("Ada/Plan.md", CLOUD + "- my note\n");
    vs.fileChanged();
    expect(vs.markdown()).toBe(CLOUD + "- my note\n");
    expect(vs.hasLocalEdits()).toBe(true);
    expect(vs.cloudMarkdown()).toBe(CLOUD);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.saves).toBe(0);
    // Another session loading the cloud sees none of it.
    const peer = await SyncSession.open("d", createDoc(), store, bus);
    expect(getMarkdown(peer.doc)).toBe(CLOUD);
    peer.close();
    vs.close();
  });

  it("merges what the cloud sends next into the fork, and keeps the fork", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d", snapshot(createDoc(CLOUD)));
    const vs = await openReadOnly(store, bus, fs);
    fs.write("Ada/Plan.md", "# Plan\n\n- alpha\n- bravo\n- my note\n");
    vs.fileChanged();

    await cloudEdit("d", "# Plan (v2)\n\n- alpha\n- bravo\n", store, bus);
    const merged = vs.markdown();
    expect(merged).toContain("Plan (v2)");
    expect(merged).toContain("my note");
    expect(fs.read("Ada/Plan.md")).toBe(merged);
    expect(vs.hasLocalEdits()).toBe(true);
    expect(vs.cloudMarkdown()).toBe("# Plan (v2)\n\n- alpha\n- bravo\n");
    vs.close();
  });

  it("is no longer a fork once the person puts the text back by hand", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d", snapshot(createDoc(CLOUD)));
    const vs = await openReadOnly(store, bus, fs);
    fs.write("Ada/Plan.md", CLOUD + "oops\n");
    vs.fileChanged();
    expect(vs.hasLocalEdits()).toBe(true);
    fs.write("Ada/Plan.md", CLOUD);
    vs.fileChanged();
    expect(vs.hasLocalEdits()).toBe(false);
    vs.close();
  });

  it("discards the fork on request: the file is the cloud's again", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d", snapshot(createDoc(CLOUD)));
    const vs = await openReadOnly(store, bus, fs);
    fs.write("Ada/Plan.md", CLOUD + "- mine\n");
    vs.fileChanged();
    expect(vs.discardLocalEdits()).toBe(true);
    expect(vs.hasLocalEdits()).toBe(false);
    expect(vs.markdown()).toBe(CLOUD);
    expect(fs.read("Ada/Plan.md")).toBe(CLOUD);
    expect(vs.discardLocalEdits()).toBe(false); // nothing left to discard
    vs.close();
  });

  it("survives a restart: the fork is still on disk, still a fork, and still following the cloud", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs(), base = new FakeBaseStore();
    await store.save("d", snapshot(createDoc(CLOUD)));
    const vs1 = await openReadOnly(store, bus, fs, base);
    fs.write("Ada/Plan.md", CLOUD + "- mine\n");
    vs1.fileChanged();
    vs1.close();
    // The base the next start merges against is the CLOUD's text, not the fork:
    // otherwise the file reads as "unchanged" and the cloud's copy overwrites it.
    expect(base.load("d")).toBe(CLOUD);

    // Meanwhile the cloud moves on.
    await cloudEdit("d", "# Plan v2\n\n- alpha\n- bravo\n", store, bus);

    const vs2 = await openReadOnly(store, bus, fs, base);
    expect(vs2.hasLocalEdits()).toBe(true);
    expect(vs2.markdown()).toContain("- mine");
    expect(vs2.markdown()).toContain("Plan v2");
    expect(fs.read("Ada/Plan.md")).toBe(vs2.markdown());
    expect(store.saves).toBe(2); // the two editor saves; none from here
    vs2.close();
  });

  it("lands the fork in one save when the person becomes an editor", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d", snapshot(createDoc(CLOUD)));
    const vs = await openReadOnly(store, bus, fs);
    fs.write("Ada/Plan.md", CLOUD + "- mine\n");
    vs.fileChanged();
    await cloudEdit("d", CLOUD + "- theirs\n", store, bus);
    store.saves = 0;

    vs.setReadOnly(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(vs.readOnly).toBe(false);
    expect(vs.hasLocalEdits()).toBe(false);
    expect(vs.cloudMarkdown()).toBeNull();
    expect(store.saves).toBe(1);
    const peer = await SyncSession.open("d", createDoc(), store, bus);
    const cloud = getMarkdown(peer.doc);
    expect(cloud).toContain("- mine");
    expect(cloud).toContain("- theirs");
    peer.close();

    // And from here it is an ordinary writable document: edits save.
    fs.write("Ada/Plan.md", cloud + "- more\n");
    vs.fileChanged();
    vs.close(); // flushes the debounced save
    await new Promise((r) => setTimeout(r, 20));
    expect(store.saves).toBe(2);
  });

  it("an editor demoted to viewer stops saving, and a later edit is a fork", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d", snapshot(createDoc(CLOUD)));
    const vs = await VaultSync.open("d", "Ada/Plan.md", store, bus, fs);
    expect(vs.readOnly).toBe(false);
    vs.setReadOnly(true);
    store.saves = 0;
    fs.write("Ada/Plan.md", CLOUD + "- late\n");
    vs.fileChanged();
    vs.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.saves).toBe(0);
  });

  it("does not record versions while read-only", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d", snapshot(createDoc(CLOUD)));
    const vs = await openReadOnly(store, bus, fs);
    vs.trackVersions("Ada");
    fs.write("Ada/Plan.md", CLOUD + "- mine\n");
    vs.fileChanged();
    expect(vs.maybeCheckpoint(Date.now() + 60 * 60_000)).toBe(false);
    vs.close();
  });
});
