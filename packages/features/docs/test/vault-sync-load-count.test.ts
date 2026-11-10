import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { VaultSync } from "../src/logic/vault-sync";
import {
  createDoc,
  snapshot,
  getMarkdown,
  type DocStore,
  type DocPubSub,
  type VaultSyncFs,
} from "../src/logic";

// One snapshot fetch per document open — not two.
//
// VaultSync.open used to load the cloud snapshot to answer "is there a CRDT yet",
// throw it away, and let SyncSession.open load the identical bytes again. Opening
// is serial and every load is a network round trip, so that doubled both the time
// a vault takes to mount and the number of chances to hit a connection that dies
// mid-body — the failure that got a document adopted twice. SyncSession.open
// accepts the already-loaded snapshot for exactly this reason.

class CountingStore implements DocStore {
  loads = 0;
  saves = 0;
  private readonly blobs = new Map<string, Uint8Array>();
  async load(id: string): Promise<Uint8Array | null> {
    this.loads++;
    return this.blobs.get(id) ?? null;
  }
  async save(id: string, snap: Uint8Array): Promise<void> {
    this.saves++;
    this.blobs.set(id, snap);
  }
}

const bus: DocPubSub = { publish() {}, subscribe: () => () => {} };

class MemFs implements VaultSyncFs {
  files = new Map<string, string>();
  read(p: string): string | null {
    return this.files.has(p) ? this.files.get(p)! : null;
  }
  write(p: string, c: string): void {
    this.files.set(p, c);
  }
}

describe("VaultSync.open — snapshot loads per document", () => {
  it("loads once when the cloud already has a CRDT and a seed is offered", async () => {
    const store = new CountingStore(), fs = new MemFs();
    await store.save("d", snapshot(createDoc("# Cloud\n")));
    store.loads = 0;
    store.saves = 0;

    await VaultSync.open("d", "d.md", store, bus, fs, undefined, "# Seed\n");
    expect(store.loads).toBe(1);
  });

  it("loads once when there is no CRDT yet (a doc created through the API)", async () => {
    const store = new CountingStore(), fs = new MemFs();
    await VaultSync.open("d", "d.md", store, bus, fs, undefined, "# Seed\n");
    expect(store.loads).toBe(1);
  });

  it("loads once with no seed at all (a file adopted from disk)", async () => {
    const store = new CountingStore(), fs = new MemFs();
    fs.write("d.md", "# Disk\n");
    await VaultSync.open("d", "d.md", store, bus, fs);
    expect(store.loads).toBe(1);
  });
});

describe("VaultSync.open — seeding still behaves", () => {
  it("seeds an empty cloud from the row's markdown", async () => {
    const store = new CountingStore(), fs = new MemFs();
    await VaultSync.open("d", "d.md", store, bus, fs, undefined, "# Seed\n");

    expect(fs.read("d.md")).toBe("# Seed\n");
    const doc = new Y.Doc();
    Y.applyUpdate(doc, (await store.load("d"))!);
    expect(getMarkdown(doc)).toBe("# Seed\n");
  });

  it("never re-seeds over an existing CRDT — the cloud is the truth", async () => {
    const store = new CountingStore(), fs = new MemFs();
    await store.save("d", snapshot(createDoc("# Cloud\n")));
    await VaultSync.open("d", "d.md", store, bus, fs, undefined, "# Seed\n");
    expect(fs.read("d.md")).toBe("# Cloud\n");
  });
});
