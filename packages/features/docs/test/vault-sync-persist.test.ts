import { describe, it, expect } from "vitest";
import { createDoc, getMarkdown, setMarkdown } from "../src/logic/crdt";
import { snapshot } from "../src/logic/sync";
import { SyncSession, type DocStore, type DocPubSub } from "../src/logic/transport";
import { VaultSync, conflictCopyPath, type VaultSyncFs, type VaultBaseStore } from "../src/logic/vault-sync";

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
// The persisted base the worker keeps on disk across restarts.
class FakeBaseStore implements VaultBaseStore {
  bases = new Map<string, string>();
  load(id: string): string | null {
    return this.bases.has(id) ? this.bases.get(id)! : null;
  }
  save(id: string, base: string): void {
    this.bases.set(id, base);
  }
}

// Simulate another client advancing the cloud while our worker is offline.
async function cloudEdit(id: string, next: string, store: DocStore, bus: DocPubSub): Promise<void> {
  const s = await SyncSession.open(id, createDoc(), store, bus);
  setMarkdown(s.doc, next, "editor");
  await Promise.resolve(); // let the fire-and-forget persist settle
  s.close();
}

const BASE = "alpha\nbravo\ncharlie\n";

describe("VaultSync: offline reconcile with a persisted base", () => {
  it("merges an offline disk edit with a concurrent cloud edit instead of clobbering", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    const baseStore = new FakeBaseStore();
    await store.save("d", snapshot(createDoc(BASE)));

    // Round 1: worker runs, establishes the shared base on disk + in the base store.
    const vs1 = await VaultSync.open("d", "f.md", store, bus, fs, baseStore);
    expect(fs.read("f.md")).toBe(BASE);
    expect(baseStore.load("d")).toBe(BASE);
    vs1.close();

    // Worker is offline. Disk is edited (line 1) AND the cloud advances (line 3).
    fs.write("f.md", "ALPHA-disk\nbravo\ncharlie\n");
    await cloudEdit("d", "alpha\nbravo\nCHARLIE-cloud\n", store, bus);

    // Round 2: worker restarts. With the persisted base it 3-way merges — both edits survive.
    const vs2 = await VaultSync.open("d", "f.md", store, bus, fs, baseStore);
    const merged = vs2.markdown();
    expect(merged).toContain("ALPHA-disk");
    expect(merged).toContain("CHARLIE-cloud");
    vs2.close();
  });

  it("without a persisted base, the same restart clobbers the cloud edit (why A4 exists)", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    await store.save("d", snapshot(createDoc(BASE)));

    const vs1 = await VaultSync.open("d", "f.md", store, bus, fs); // no base store
    vs1.close();

    fs.write("f.md", "ALPHA-disk\nbravo\ncharlie\n");
    await cloudEdit("d", "alpha\nbravo\nCHARLIE-cloud\n", store, bus);

    const vs2 = await VaultSync.open("d", "f.md", store, bus, fs); // no base store
    // The cloud edit is lost: disk is treated as the only change against the cloud base.
    expect(vs2.markdown()).not.toContain("CHARLIE-cloud");
    vs2.close();
  });
});

describe("VaultSync: a conflict keeps the cloud's text and a copy of the file's", () => {
  // 2026-11-08: a file emptied offline and a sentence typed in the browser met
  // on a restart. The merge wrote git-style markers into the document, and
  // markdown read the ======= line as a heading — the document was retitled
  // after its own markers and the file renamed to match. Now the cloud's text
  // stands, the file's goes to .conflicts/, and no marker reaches either.
  it("writes the file's text to .conflicts/ and the cloud's text to the file", async () => {
    const store = new FakeStore(), bus = new FakeBus(), fs = new MemFs();
    const baseStore = new FakeBaseStore();
    fs.write("f.md", BASE);
    const vs1 = await VaultSync.open("d", "f.md", store, bus, fs, baseStore);
    vs1.close();

    await cloudEdit("d", "typed in the browser\n", store, bus); // whole text replaced there
    fs.write("f.md", "Hello\n"); // and replaced here, offline

    const conflicts: { path: string; copy: string }[] = [];
    const vs2 = await VaultSync.open("d", "f.md", store, bus, fs, baseStore, undefined, {
      onConflict: (c) => conflicts.push(c),
    });

    expect(vs2.markdown()).toBe("typed in the browser\n");
    expect(vs2.markdown()).not.toContain("<<<<<<<");
    expect(fs.read("f.md")).toBe("typed in the browser\n");
    const copies = [...fs.files.keys()].filter((k) => k.startsWith(".conflicts/f "));
    expect(copies).toHaveLength(1);
    expect(fs.read(copies[0])).toBe("Hello\n");
    expect(conflicts).toEqual([{ path: "f.md", copy: copies[0] }]);
    vs2.close();
  });

  it("names the copy after the file, with a filesystem-safe stamp", () => {
    expect(conflictCopyPath("notes/Roadmap.md", new Date("2026-11-08T16:25:54.211Z"))).toBe(
      ".conflicts/Roadmap 2026-11-08T16-25-54.md"
    );
  });
});
