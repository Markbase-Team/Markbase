import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { configureSupabase } from "@markbase/protocol/supabase";
import { SupabaseDocPubSub, bytesToBase64, base64ToBytes } from "../src/logic/crdt-supabase";
import { createDoc, getMarkdown, setMarkdown } from "../src/logic/crdt";
import { restore, snapshot } from "../src/logic/sync";

// --- Pure unit: base64 is where binary Yjs state could corrupt, so cover the
// awkward bytes (high, zero, empty) with no Supabase involved. Runs in CI.
describe("base64 helpers", () => {
  it("round-trips arbitrary bytes, including high/zero bytes", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 65, 0, 200]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
  it("round-trips an empty buffer", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array()))).toEqual(new Uint8Array());
  });
});

// --- Integration: the server store and the Realtime adapter are thin glue, so
// the only thing a fake can't prove is that the real SQL (schema/table/column,
// the compare-and-swap on `version`) and Realtime delivery actually work. Runs
// only when a Supabase is configured — `supabase start` locally, then
// SUPABASE_URL + SUPABASE_KEY (the SECRET key: this is the server's path, which
// bypasses RLS as the server does), with the stage-2 migration applied. Skips
// in plain CI.
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;

describe.skipIf(!URL || !KEY)("server CRDT store + Realtime pub/sub (live)", () => {
  // built lazily inside tests — the describe body runs even when skipped, and
  // createClient throws on an undefined URL.
  const makeClient = () => createClient(URL!, KEY!, { auth: { persistSession: false } });
  const empty = { type: "doc", content: [] };

  async function seedDocument(client: ReturnType<typeof makeClient>, title: string) {
    const docId = crypto.randomUUID();
    const { error } = await client.schema("docs").from("documents").insert({
      id: docId,
      title,
      doc_json: empty,
      base_doc: empty,
      content: "",
      owner_id: crypto.randomUUID(),
    });
    expect(error).toBeNull();
    return docId;
  }

  it("save then load round-trips the snapshot through docs.doc_crdt, with a version", async () => {
    configureSupabase(URL!, KEY!);
    const { loadCrdtSnapshot, saveCrdtSnapshot } = await import("../src/server/crdt-store");
    const client = makeClient();
    // doc_crdt.doc_id is a real FK to documents(id), so a CRDT needs a document
    // to belong to — seed one, then let the cascade clean the snapshot up.
    const docId = await seedDocument(client, "__crdt integration test__");
    try {
      const a = createDoc("# Hello\n");
      const first = await saveCrdtSnapshot(docId, snapshot(a));
      expect(first).toMatchObject({ version: 1, changed: true });

      const loaded = await loadCrdtSnapshot(docId);
      expect(loaded?.version).toBe(1);
      expect(getMarkdown(restore(loaded!.state))).toBe("# Hello\n");

      // A second replica, behind, saves its own edit: both edits survive.
      const b = restore(snapshot(a));
      setMarkdown(a, "# Hello\n\nfrom A\n");
      setMarkdown(b, "# Hello\n\nfrom B\n");
      await saveCrdtSnapshot(docId, snapshot(a));
      const second = await saveCrdtSnapshot(docId, snapshot(b));
      expect(second.version).toBe(3);
      const merged = getMarkdown(restore((await loadCrdtSnapshot(docId))!.state));
      expect(merged).toContain("from A");
      expect(merged).toContain("from B");

      // Saving what is already there changes nothing and bumps nothing.
      const again = await saveCrdtSnapshot(docId, second.state);
      expect(again).toMatchObject({ version: 3, changed: false });
    } finally {
      // deleting the document cascades its doc_crdt row away
      await client.schema("docs").from("documents").delete().eq("id", docId);
    }
  });

  it("deleting a document cascades its CRDT away (no orphan snapshots)", async () => {
    configureSupabase(URL!, KEY!);
    const { loadCrdtSnapshot, saveCrdtSnapshot } = await import("../src/server/crdt-store");
    const client = makeClient();
    const docId = await seedDocument(client, "__crdt cascade test__");
    await saveCrdtSnapshot(docId, snapshot(createDoc("x\n")));
    expect(await loadCrdtSnapshot(docId)).not.toBeNull();

    await client.schema("docs").from("documents").delete().eq("id", docId);
    expect(await loadCrdtSnapshot(docId)).toBeNull(); // gone with the document
  });

  it("delivers a published update to another subscriber over Realtime", async () => {
    // Two clients, mirroring real SyncSession usage: each opens its own channel
    // and subscribes; A then publishes and B (self:false) receives it. On the
    // secret key the socket is the service role, which the private channel's
    // policies never see.
    const a = new SupabaseDocPubSub(makeClient());
    const b = new SupabaseDocPubSub(makeClient());
    const docId = crypto.randomUUID();
    const update = new Uint8Array([1, 2, 3, 250]);

    const got = new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no Realtime delivery in 8s")), 8000);
      b.subscribe(docId, (u) => {
        clearTimeout(timer);
        resolve(u);
      });
    });
    // A also joins the channel (subscribe) so its send goes over the joined
    // socket, as it would in a SyncSession; then give both joins time to settle.
    a.subscribe(docId, () => {});
    await new Promise((r) => setTimeout(r, 2500));
    void a.publish(docId, update);
    expect(await got).toEqual(update);
  }, 15000);
});
