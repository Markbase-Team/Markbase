import { describe, it, expect } from "vitest";
import { createDoc, getMarkdown } from "../src/logic/crdt";
import { snapshot } from "../src/logic/sync";
import type { DocStore, DocPubSub } from "../src/logic/transport";
import { openEditorDoc } from "../src/logic/editor-doc";

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
  publish(): void {}
  subscribe(): () => void {
    return () => {};
  }
}

describe("openEditorDoc", () => {
  it("seeds from the document's content when the cloud has no CRDT yet", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    const opened = await openEditorDoc("doc1", "# Title\n\nbody\n", store, bus);
    expect(opened.seeded).toBe(true);
    expect(getMarkdown(opened.doc)).toBe("# Title\n\nbody\n");
    // persisted, so the next opener hydrates instead of re-seeding
    expect(await store.load("doc1")).not.toBeNull();
    opened.session.close();
  });

  it("hydrates from the cloud and ignores initialMarkdown when CRDT already exists", async () => {
    const store = new FakeStore(), bus = new FakeBus();
    await store.save("doc2", snapshot(createDoc("cloud is truth\n")));
    const opened = await openEditorDoc("doc2", "# stale server render\n", store, bus);
    expect(opened.seeded).toBe(false);
    expect(getMarkdown(opened.doc)).toBe("cloud is truth\n");
    opened.session.close();
  });
});
