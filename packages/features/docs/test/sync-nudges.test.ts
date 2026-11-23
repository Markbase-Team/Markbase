import { beforeEach, describe, expect, it, vi } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/shared/auth";
import type { EndpointCall, EndpointDef } from "@markbase/shared/endpoint";
import type { NudgeKind } from "@markbase/shared/sync-nudges";

// Which writes nudge whose syncs, and with what kind of change.

const nudged: { accounts: string[]; kind: NudgeKind }[] = [];
vi.mock("@markbase/server/nudges", () => ({
  sendNudges: async (accounts: string[], kind: NudgeKind) => {
    nudged.push({ accounts, kind });
    return accounts.length;
  },
}));
vi.mock("../src/server/documents", () => ({
  getDocument: async (id: string) => (id === "d1" ? { id, owner_id: "owner" } : null),
}));
vi.mock("../src/server/members", () => ({
  listMembers: async (id: string) => (id === "d1" ? [{ user_id: "member" }] : []),
}));

const { nudgeAfterWrite, nudgeKindFor } = await import("../src/server/sync-nudges");

const def = (id: string, path: string, scope: "read" | "write" = "write"): EndpointDef => ({
  id,
  method: scope === "read" ? "GET" : "POST",
  path,
  scope,
  summary: id,
});
const ME: Caller = { via: "api_key", ownerId: "me", key: { id: "k", provider: "claude_code", capability: null } };

function call(d: EndpointDef, status = 200, params: { [k: string]: string } = {}, caller: Caller | null = ME): EndpointCall {
  const headers = new Headers();
  if (caller) headers.set(CALLER_HEADER, serializeCaller(caller));
  return { def: d, req: new Request("https://x.test", { headers }), params, status, durationMs: 1 };
}

beforeEach(() => {
  nudged.length = 0;
});

describe("nudgeKindFor", () => {
  it("calls a change to a document's text content, and the rest of what a sync keeps structure", () => {
    expect(nudgeKindFor(call(def("docs_writeCrdt", "/docs/:id/crdt")))).toBe("content");
    expect(nudgeKindFor(call(def("docs_editDoc", "/docs/:id/edits")))).toBe("content");
    expect(nudgeKindFor(call(def("docs_renameDoc", "/docs/:id")))).toBe("structure");
    expect(nudgeKindFor(call(def("docs_createVault", "/vaults")))).toBe("structure");
  });

  it("nudges for nothing a sync does not keep, nothing read and nothing that failed", () => {
    expect(nudgeKindFor(call(def("docs_addComment", "/docs/:id/comments")))).toBeNull();
    expect(nudgeKindFor(call(def("docs_reportVaultHookEvents", "/vaults/hook-events")))).toBeNull();
    expect(nudgeKindFor(call(def("docs_readDoc", "/docs/:id", "read")))).toBeNull();
    expect(nudgeKindFor(call(def("docs_renameDoc", "/docs/:id"), 403))).toBeNull();
  });
});

describe("nudgeAfterWrite", () => {
  it("nudges the writer and everyone who has the document", async () => {
    await nudgeAfterWrite(call(def("docs_editDoc", "/docs/:id/edits"), 200, { id: "d1" }));
    expect(nudged).toEqual([{ accounts: ["me", "owner", "member"], kind: "content" }]);
  });

  it("nudges only the writer for a write that names no document", async () => {
    await nudgeAfterWrite(call(def("docs_createVault", "/vaults"), 201));
    expect(nudged).toEqual([{ accounts: ["me"], kind: "structure" }]);
  });

  it("still nudges the writer when the document is gone", async () => {
    await nudgeAfterWrite(call(def("docs_deleteDoc", "/docs/:id"), 200, { id: "gone" }));
    expect(nudged).toEqual([{ accounts: ["me"], kind: "structure" }]);
  });

  it("nudges nobody for a call with no caller or nothing to nudge for", async () => {
    await nudgeAfterWrite(call(def("docs_editDoc", "/docs/:id/edits"), 200, { id: "d1" }, null));
    await nudgeAfterWrite(call(def("docs_readDoc", "/docs/:id", "read"), 200, { id: "d1" }));
    expect(nudged).toEqual([]);
  });
});
