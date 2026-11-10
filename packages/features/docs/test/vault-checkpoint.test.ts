import { describe, it, expect } from "vitest";
import { listVersions, versionCount } from "../src/logic/versions";
import type { DocStore, DocPubSub } from "../src/logic/transport";
import { VaultSync, type VaultSyncFs } from "../src/logic/vault-sync";

// The vault daemon records versions too — and they belong to the PERSON.
//
// Why this exists at all: the daemon has never checkpointed. The browser ticker
// does, and it checkpoints whatever is in the Y.Doc — including content that
// arrived from the daemon — crediting whoever has the doc open. While the
// browser passed `undefined` that was harmless. The moment it passes a real
// name, a file you edited in Obsidian gets credited to whoever happened to have
// the document open in a tab. So the daemon has to record its own versions in
// the same change that gives the browser an author.
//
// Who to credit: you. You typed it, in Obsidian; the daemon is transport, not
// the author. That is why `trackVersions` takes a person's name and not a
// machine or a connection.
//
// The load-bearing test here is "a cloud edit is not ours to record" — it is the
// misattribution bug above, written down.

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
  subscribe(id: string, onUpdate: (u: Uint8Array) => void): () => void {
    let set = this.subs.get(id);
    if (!set) {
      set = new Set();
      this.subs.set(id, set);
    }
    set.add(onUpdate);
    return () => set.delete(onUpdate);
  }
}

/** An in-memory disk that counts writes, so "did a checkpoint touch the file?"
 *  is answerable without a real filesystem. */
class FakeFs implements VaultSyncFs {
  readonly files = new Map<string, string>();
  writes = 0;
  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }
  write(path: string, content: string): void {
    this.writes++;
    this.files.set(path, content);
  }
}

const PATH = "note.md";
const MIN = 60_000;
/** Past the 2-minute idle window, so the cadence rules say "a thought finished". */
const settled = (): number => Date.now() + 3 * MIN;

describe("VaultSync version tracking", () => {
  it("records a local disk edit, attributed to the person", async () => {
    const store = new FakeStore();
    const bus = new FakeBus();
    const fs = new FakeFs();
    fs.files.set(PATH, "# Note\n");

    const vs = await VaultSync.open("d1", PATH, store, bus, fs);
    vs.trackVersions("Jessie");

    fs.files.set(PATH, "# Note\n\nwritten in Obsidian\n");
    vs.fileChanged();

    expect(vs.maybeCheckpoint(settled())).toBe(true);
    const [v] = listVersions(vs.doc);
    expect(v.author).toBe("Jessie");
    vs.close();
  });

  // THE bug this feature would otherwise introduce. Two machines sync one doc;
  // B edits its file; A must not record B's words under A's owner's name.
  it("does not record an edit that arrived from the cloud", async () => {
    const store = new FakeStore();
    const bus = new FakeBus();
    const fsA = new FakeFs();
    const fsB = new FakeFs();
    fsA.files.set(PATH, "# Shared\n");

    const a = await VaultSync.open("d1", PATH, store, bus, fsA);
    const b = await VaultSync.open("d1", PATH, store, bus, fsB);
    a.trackVersions("Jessie");
    b.trackVersions("Sam");

    // B's machine: a real local edit.
    fsB.files.set(PATH, "# Shared\n\nfrom Sam\n");
    b.fileChanged();

    // It reached A over the bus — but A did not write it.
    expect(a.markdown()).toContain("from Sam");
    expect(a.maybeCheckpoint(settled())).toBe(false);
    expect(versionCount(a.doc)).toBe(0);

    // B, who did write it, records it.
    expect(b.maybeCheckpoint(settled())).toBe(true);
    expect(listVersions(b.doc)[0].author).toBe("Sam");

    a.close();
    b.close();
  });

  // A checkpoint writes to the `versions` Y.Array, and VaultSync flushes to disk
  // on every doc update — but flushToDisk compares the `source` Y.Text, which a
  // checkpoint does not touch. If that ever stops being true, the daemon starts
  // rewriting every file it versions.
  it("does not rewrite the file", async () => {
    const store = new FakeStore();
    const bus = new FakeBus();
    const fs = new FakeFs();
    fs.files.set(PATH, "# Note\n");

    const vs = await VaultSync.open("d1", PATH, store, bus, fs);
    vs.trackVersions("Jessie");
    fs.files.set(PATH, "# Note\n\nedited\n");
    vs.fileChanged();

    const before = fs.writes;
    expect(vs.maybeCheckpoint(settled())).toBe(true);
    expect(fs.writes).toBe(before);
    vs.close();
  });

  it("records nothing until version tracking is switched on", async () => {
    const store = new FakeStore();
    const bus = new FakeBus();
    const fs = new FakeFs();
    fs.files.set(PATH, "# Note\n");

    const vs = await VaultSync.open("d1", PATH, store, bus, fs);
    fs.files.set(PATH, "# Note\n\nedited\n");
    vs.fileChanged();

    expect(vs.maybeCheckpoint(settled())).toBe(false);
    expect(versionCount(vs.doc)).toBe(0);
    vs.close();
  });

  // A daemon that cannot resolve who it belongs to (the app is down, the key was
  // revoked) still keeps history. An unattributed version beats no version.
  it("still records when the owner could not be resolved", async () => {
    const store = new FakeStore();
    const bus = new FakeBus();
    const fs = new FakeFs();
    fs.files.set(PATH, "# Note\n");

    const vs = await VaultSync.open("d1", PATH, store, bus, fs);
    vs.trackVersions(null);
    fs.files.set(PATH, "# Note\n\nedited\n");
    vs.fileChanged();

    expect(vs.maybeCheckpoint(settled())).toBe(true);
    expect(listVersions(vs.doc)[0].author).toBeUndefined();
    vs.close();
  });

  // Cadence is shouldCheckpoint's job, not a second implementation of it.
  it("waits while the file is still being edited", async () => {
    const store = new FakeStore();
    const bus = new FakeBus();
    const fs = new FakeFs();
    fs.files.set(PATH, "# Note\n");

    const vs = await VaultSync.open("d1", PATH, store, bus, fs);
    vs.trackVersions("Jessie");

    fs.files.set(PATH, "# Note\n\none\n");
    vs.fileChanged();
    expect(vs.maybeCheckpoint(settled())).toBe(true); // the first version

    fs.files.set(PATH, "# Note\n\none two\n");
    vs.fileChanged();
    // Saved a moment ago and still typing: mid-thought, not finished.
    expect(vs.maybeCheckpoint(Date.now())).toBe(false);
    expect(versionCount(vs.doc)).toBe(1);
    vs.close();
  });

  it("does not record the same content twice", async () => {
    const store = new FakeStore();
    const bus = new FakeBus();
    const fs = new FakeFs();
    fs.files.set(PATH, "# Note\n");

    const vs = await VaultSync.open("d1", PATH, store, bus, fs);
    vs.trackVersions("Jessie");
    fs.files.set(PATH, "# Note\n\nedited\n");
    vs.fileChanged();

    expect(vs.maybeCheckpoint(settled())).toBe(true);
    expect(vs.maybeCheckpoint(settled())).toBe(false);
    expect(versionCount(vs.doc)).toBe(1);
    vs.close();
  });

  // The versions Y.Array rides the same channel as the content, so a version
  // recorded by the daemon has to reach the browser with nothing extra.
  it("publishes the version to other clients", async () => {
    const store = new FakeStore();
    const bus = new FakeBus();
    const fsA = new FakeFs();
    const fsB = new FakeFs();
    fsA.files.set(PATH, "# Shared\n");

    const a = await VaultSync.open("d1", PATH, store, bus, fsA);
    const b = await VaultSync.open("d1", PATH, store, bus, fsB);
    a.trackVersions("Jessie");

    fsA.files.set(PATH, "# Shared\n\nfrom Jessie\n");
    a.fileChanged();
    expect(a.maybeCheckpoint(settled())).toBe(true);

    expect(listVersions(b.doc)[0]?.author).toBe("Jessie");
    a.close();
    b.close();
  });
});
