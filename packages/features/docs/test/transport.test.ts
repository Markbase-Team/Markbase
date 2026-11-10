import { describe, it, expect } from "vitest";
import { createDoc, getMarkdown, setMarkdown } from "../src/logic/crdt";
import { SyncSession, type DocStore, type DocPubSub } from "../src/logic/transport";

// In-memory store + pub/sub so the sync lifecycle is testable without Supabase.
// The store is async, mirroring a real backend.
class FakeStore implements DocStore {
  saves = 0;
  private blobs = new Map<string, Uint8Array>();
  async load(id: string): Promise<Uint8Array | null> {
    return this.blobs.get(id) ?? null;
  }
  async save(id: string, snap: Uint8Array): Promise<void> {
    this.blobs.set(id, snap);
    this.saves++;
  }
}

class FakeBus implements DocPubSub {
  private subs = new Map<string, Set<(u: Uint8Array) => void>>();
  publishes = 0;
  publish(id: string, update: Uint8Array): void {
    this.publishes++;
    for (const h of this.subs.get(id) ?? []) h(update);
  }
  subscribe(id: string, onUpdate: (u: Uint8Array) => void): () => void {
    let set = this.subs.get(id);
    if (!set) this.subs.set(id, (set = new Set()));
    set.add(onUpdate);
    return () => set!.delete(onUpdate);
  }
}

describe("SyncSession: two clients converge over the bus", () => {
  it("a local edit propagates to another session", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    const a = await SyncSession.open("d1", createDoc("# Doc\n"), store, bus);
    const b = await SyncSession.open("d1", createDoc(), store, bus);
    setMarkdown(a.doc, "# Doc\n\nfrom A\n", "editor");
    expect(getMarkdown(b.doc)).toContain("from A");
    a.close();
    b.close();
  });
});

describe("SyncSession: persistence", () => {
  it("coalesces rapid edits instead of writing a snapshot per keystroke", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    const a = await SyncSession.open("d2", createDoc("start\n"), store, bus);
    const afterOpen = store.saves; // the seed write for an empty store

    setMarkdown(a.doc, "start\nline one\n", "editor");
    setMarkdown(a.doc, "start\nline one\nline two\n", "editor");
    await Promise.resolve();

    // A snapshot is the WHOLE document; typing must not upload it per edit.
    expect(store.saves).toBe(afterOpen);
    // But every edit goes out live — that is what other peers need.
    expect(bus.publishes).toBe(2);

    // And nothing is lost: closing writes whatever the debounce was holding.
    a.close();
    expect(store.saves).toBe(afterOpen + 1);

    const fresh = await SyncSession.open("d2", createDoc(), store, bus);
    expect(getMarkdown(fresh.doc)).toContain("line two");
    fresh.close();
  });

  it("flush() persists without waiting out the debounce", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    const a = await SyncSession.open("d3", createDoc("start\n"), store, bus);
    const afterOpen = store.saves;
    setMarkdown(a.doc, "start\nreconciled\n", "editor");
    expect(store.saves).toBe(afterOpen);
    a.flush();
    expect(store.saves).toBe(afterOpen + 1);
    a.close();
  });
});

describe("SyncSession: no echo loop", () => {
  it("a received remote update is not re-published", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    const a = await SyncSession.open("d3", createDoc("base\n"), store, bus);
    const b = await SyncSession.open("d3", createDoc(), store, bus);
    const before = bus.publishes;
    setMarkdown(a.doc, "base\nX\n", "editor"); // one logical publish from A
    expect(bus.publishes).toBe(before + 1); // B did not re-publish it
    expect(getMarkdown(a.doc)).toBe(getMarkdown(b.doc));
    a.close();
    b.close();
  });
});
