import { describe, it, expect } from "vitest";
import type { DocStore, DocPubSub } from "../src/logic/transport";
import { VaultSync, type VaultSyncFs } from "../src/logic/vault-sync";

// A file that reads as empty is not proof that it IS empty.
//
// `cp`, `>` redirection, and plenty of editors write a file by truncating it and
// then writing — which leaves a window, sometimes microseconds long, where the
// file is zero bytes. The watcher fires on the truncate, we read 0 bytes, and
// the daemon has no way to tell that from someone genuinely clearing the file.
//
// On 2026-09-21 that emptied a real document for every client: a `cp` of a
// backup over a vault file was seen as an edit-to-empty, applied to the CRDT,
// pushed to the cloud, and recorded as a version (removed: 1056). An identical
// `cp` on the same file minutes earlier had won the race, which is what makes
// this so easy to dismiss as a one-off.
//
// So: an empty read of a NON-empty document is suspect, and is held rather than
// applied. The sweep the manager already runs confirms it — if the file is still
// empty then, the emptying was real and is applied. A deliberate clear therefore
// syncs on the next sweep instead of instantly, which is the right trade against
// losing a document to a write that was merely in progress.
//
// NOT covered here: VaultSync.open has the same vector — a daemon restarting
// while a file is mid-write reads 0 bytes and applies them. That path is left
// as-is deliberately; this fixes the one that bit us.

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

class FakeFs implements VaultSyncFs {
  readonly files = new Map<string, string>();
  read(path: string): string | null {
    return this.files.get(path) ?? null;
  }
  write(path: string, content: string): void {
    this.files.set(path, content);
  }
}

const PATH = "note.md";
const BODY = "# Note\n\nReal content that must survive a truncate window.\n";

async function openWith(body: string): Promise<{ vs: VaultSync; fs: FakeFs }> {
  const fs = new FakeFs();
  fs.files.set(PATH, body);
  const vs = await VaultSync.open("d1", PATH, new FakeStore(), new FakeBus(), fs);
  return { vs, fs };
}

describe("VaultSync: a transient empty file does not empty the document", () => {
  // The incident, written down.
  it("holds an empty read of a non-empty document instead of applying it", async () => {
    const { vs, fs } = await openWith(BODY);

    fs.files.set(PATH, ""); // the truncate half of cp's truncate-then-write
    vs.fileChanged();

    expect(vs.markdown()).toBe(BODY);
    vs.close();
  });

  // The write half arrives a moment later; that content is real and applies.
  it("applies the real content once the writer finishes", async () => {
    const { vs, fs } = await openWith(BODY);

    fs.files.set(PATH, "");
    vs.fileChanged(); // suspect — held
    const restored = "# Note\n\nRewritten by the tool that truncated it.\n";
    fs.files.set(PATH, restored);
    vs.fileChanged();

    expect(vs.markdown()).toBe(restored);
    vs.close();
  });

  // Someone really did clear the file. Confirmed on the sweep, then honoured —
  // the guard delays a deliberate emptying, it does not refuse one.
  it("honours a genuine emptying once the sweep confirms it", async () => {
    const { vs, fs } = await openWith(BODY);

    fs.files.set(PATH, "");
    vs.fileChanged(); // suspect — held
    expect(vs.markdown()).toBe(BODY);

    expect(vs.confirmPendingEmpty()).toBe(true); // still empty on disk
    expect(vs.markdown()).toBe("");
    vs.close();
  });

  // The writer finished before the sweep ran, so there is nothing to confirm.
  it("drops the suspicion when the file is no longer empty at sweep time", async () => {
    const { vs, fs } = await openWith(BODY);

    fs.files.set(PATH, "");
    vs.fileChanged();
    fs.files.set(PATH, BODY); // cp's write landed

    expect(vs.confirmPendingEmpty()).toBe(false);
    expect(vs.markdown()).toBe(BODY);
    vs.close();
  });

  it("has nothing to confirm when no empty read happened", async () => {
    const { vs } = await openWith(BODY);
    expect(vs.confirmPendingEmpty()).toBe(false);
    expect(vs.markdown()).toBe(BODY);
    vs.close();
  });

  // An already-empty document reading as empty is not a transition, so the
  // guard must not treat it as suspect or the doc would never settle.
  it("is not suspicious of an empty document that is still empty", async () => {
    const { vs, fs } = await openWith("");

    fs.files.set(PATH, "");
    vs.fileChanged();

    expect(vs.markdown()).toBe("");
    expect(vs.confirmPendingEmpty()).toBe(false);
    vs.close();
  });

  // The guard is narrow on purpose: only empty-over-non-empty is held. Ordinary
  // edits, including large deletions, apply immediately as they always did.
  it("leaves ordinary edits alone, including a near-total deletion", async () => {
    const { vs, fs } = await openWith(BODY);

    const nearlyGone = "x";
    fs.files.set(PATH, nearlyGone);
    vs.fileChanged();

    expect(vs.markdown()).toBe(nearlyGone);
    vs.close();
  });
});
