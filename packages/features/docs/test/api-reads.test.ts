import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { createDoc } from "@markbase/protocol/docs/crdt";
import { restore, snapshot } from "@markbase/protocol/docs/sync";
import { versionCount } from "@markbase/protocol/docs/versions";
import { addApiRead, addAgentReads, listAgentReads, API_READ_WINDOW_MS } from "@markbase/protocol/docs/analytics";
import type { Actor } from "../src/server/auth";

// An agent that reads a document through the API (an MCP tool) is counted in
// "Read by agents", the way its file hooks count a read of the file. These pin
// who counts, that a quick re-read is one look, that a read never makes a
// version, and that a document with no CRDT is not created to hold a read.

const store = new Map<string, Uint8Array>();
const saves: string[] = [];
vi.mock("../src/server/crdt-store", () => ({
  loadCrdtSnapshot: async (id: string) => (store.has(id) ? { state: store.get(id)!, version: 1 } : null),
  saveCrdtSnapshot: async (id: string, incoming: Uint8Array) => {
    saves.push(id);
    store.set(id, incoming);
    return { changed: true, state: incoming, version: 2 };
  },
  broadcastCrdt: async () => undefined,
}));
vi.mock("../src/server/documents", () => ({ mirrorDocContent: async () => {} }));

const { apiReader, countApiRead } = await import("../src/server/doc-crdt");

const CLAUDE: Actor = { kind: "agent", userId: "u1", name: "Jessie's Claude", agent: { owner: "Jessie", tool: "claude" } };
const APP_KEY: Actor = { kind: "agent", userId: "u1", name: "Jessie's agent", agent: { owner: "Jessie", tool: null } };
const SESSION: Actor = { kind: "agent", userId: "u1", name: "my-session" };
const PERSON: Actor = { kind: "user", userId: "u1", name: "Jessie" };
const NOW = 1_795_118_667_027;

const readsOf = (id: string) => {
  const doc = restore(store.get(id)!);
  try {
    return { reads: listAgentReads(doc), versions: versionCount(doc) };
  } finally {
    doc.destroy();
  }
};

beforeEach(() => {
  store.clear();
  saves.length = 0;
});

describe("addApiRead", () => {
  it("adds one read, and a re-read inside the window adds nothing", () => {
    const doc = new Y.Doc();
    expect(addApiRead(doc, { agent: "claude", owner: "Jessie" }, NOW)).toBe(true);
    expect(addApiRead(doc, { agent: "claude", owner: "Jessie" }, NOW + API_READ_WINDOW_MS - 1)).toBe(false);
    expect(addApiRead(doc, { agent: "claude", owner: "Jessie" }, NOW + API_READ_WINDOW_MS)).toBe(true);
    expect(listAgentReads(doc)).toEqual([{ agent: "claude", owner: "Jessie", count: 2, lastAt: NOW + API_READ_WINDOW_MS }]);
  });

  it("lands in the same row as the agent's hook-recorded reads", () => {
    const doc = new Y.Doc();
    addAgentReads(doc, [{ agent: "claude", owner: "Jessie", count: 3, lastAt: NOW - 10 * API_READ_WINDOW_MS }]);
    addApiRead(doc, { agent: "claude", owner: "Jessie" }, NOW);
    expect(listAgentReads(doc)).toEqual([{ agent: "claude", owner: "Jessie", count: 4, lastAt: NOW }]);
  });
});

describe("apiReader", () => {
  it("is the agent's tool and its owner, the way a hook names them", () => {
    expect(apiReader(CLAUDE)).toEqual({ agent: "claude", owner: "Jessie" });
  });

  it("is nobody for a person, a key that names no tool, or a named session", () => {
    expect(apiReader(PERSON)).toBeNull();
    expect(apiReader(APP_KEY)).toBeNull();
    expect(apiReader(SESSION)).toBeNull();
  });
});

describe("countApiRead", () => {
  it("counts an agent's read, once per window, without cutting a version", async () => {
    store.set("doc_1", snapshot(createDoc("# Notes\n")));
    expect(await countApiRead("doc_1", CLAUDE, NOW)).toBe(true);
    expect(await countApiRead("doc_1", CLAUDE, NOW + 1_000)).toBe(false);
    expect(saves).toEqual(["doc_1"]);
    expect(readsOf("doc_1")).toEqual({ reads: [{ agent: "claude", owner: "Jessie", count: 1, lastAt: NOW }], versions: 0 });
  });

  it("writes nothing for a reader that is not counted", async () => {
    store.set("doc_1", snapshot(createDoc("# Notes\n")));
    for (const actor of [PERSON, APP_KEY, SESSION]) expect(await countApiRead("doc_1", actor, NOW)).toBe(false);
    expect(saves).toEqual([]);
  });

  it("does not create a CRDT for a document that has none", async () => {
    expect(await countApiRead("doc_new", CLAUDE, NOW)).toBe(false);
    expect(store.has("doc_new")).toBe(false);
  });
});
