import { describe, expect, it } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/shared/auth";
import type { EndpointCall, EndpointDef, JsonValue } from "@markbase/shared/endpoint";
import { SYNC_REQUEST_HEADER } from "@markbase/shared/analytics/user-analytics";
import { createdIdsIn, createdIdsOf, eventForEndpointCall, eventForMcpEvent } from "../../src/analytics/user-analytics-recorder";

// Which handled requests become a line in a customer's record, and what the
// line says.

const agent: Caller = { via: "api_key", ownerId: "u1", key: { id: "k1", provider: "claude_desktop", capability: null } };
const person: Caller = { via: "session", ownerId: "u1", email: "a@example.test" };

const READ: EndpointDef = { id: "docs_readDoc", method: "GET", path: "/docs/:id", scope: "read", summary: "Read" };
const EDIT: EndpointDef = { id: "docs_editDoc", method: "POST", path: "/docs/:id/edits", scope: "write", summary: "Edit" };
const LIST_VAULTS: EndpointDef = { id: "docs_listVaults", method: "GET", path: "/vaults", scope: "read", summary: "List" };
const RENAME_VAULT: EndpointDef = { id: "docs_renameVault", method: "PATCH", path: "/vaults/:id", scope: "write", summary: "Rename" };
const WRITE_CRDT: EndpointDef = {
  id: "docs_writeCrdt",
  method: "POST",
  path: "/docs/:id/crdt",
  scope: "write",
  summary: "Sync",
  humanOnly: true,
  why: "The editor's own sync, not something to hand an agent.",
};

function call(
  def: EndpointDef,
  caller: Caller | null,
  over: Partial<EndpointCall> = {},
  client?: string,
  sync = false
): EndpointCall {
  const headers = new Headers();
  if (caller) headers.set(CALLER_HEADER, serializeCaller(caller));
  if (client) headers.set("X-MCP-Client", client);
  if (sync) headers.set(SYNC_REQUEST_HEADER, "1");
  return {
    def,
    req: new Request("https://x.test/api/v1/whatever", { headers }),
    params: def.path.includes(":id") ? { id: "id-1" } : {},
    status: 200,
    durationMs: 12,
    readBody: async () => null,
    ...over,
  };
}

describe("eventForEndpointCall", () => {
  it("records an agent's read through MCP, with the document it named", () => {
    expect(eventForEndpointCall(call(READ, agent, {}, "claude-ai"))).toEqual({
      ownerId: "u1",
      actor: { kind: "agent", keyId: "k1", provider: "claude_desktop", client: "claude-ai" },
      channel: "mcp",
      action: "docs_readDoc",
      docId: "id-1",
      vaultId: null,
      outcome: "success",
      status: 200,
      durationMs: 12,
    });
  });

  it("calls a key with no MCP client the plain API", () => {
    expect(eventForEndpointCall(call(READ, agent))).toMatchObject({ channel: "api", actor: { client: null } });
  });

  it("names the vault for a vault endpoint, and nothing for a list", () => {
    expect(eventForEndpointCall(call(RENAME_VAULT, agent))).toMatchObject({ vaultId: "id-1", docId: null });
    expect(eventForEndpointCall(call(LIST_VAULTS, agent))).toMatchObject({ vaultId: null, docId: null });
  });

  it("reads the outcome from the status", () => {
    expect(eventForEndpointCall(call(EDIT, agent, { status: 403 }))).toMatchObject({ outcome: "denied", status: 403 });
    expect(eventForEndpointCall(call(EDIT, agent, { status: 404 }))).toMatchObject({ outcome: "error" });
    expect(eventForEndpointCall(call(EDIT, agent, { status: 500 }))).toMatchObject({ outcome: "error" });
  });

  it("records what a person changes in the app, not what the app reads", () => {
    expect(eventForEndpointCall(call(EDIT, person))).toMatchObject({ channel: "app", actor: { kind: "person" }, action: "docs_editDoc" });
    expect(eventForEndpointCall(call(READ, person))).toBeNull();
  });

  it("leaves out an endpoint agents are not offered, whoever calls it", () => {
    expect(eventForEndpointCall(call(WRITE_CRDT, agent))).toBeNull();
    expect(eventForEndpointCall(call(WRITE_CRDT, person))).toBeNull();
  });

  it("leaves out a vault sync's reads, and keeps what it changes", () => {
    expect(eventForEndpointCall(call(LIST_VAULTS, agent, {}, undefined, true))).toBeNull();
    expect(eventForEndpointCall(call(READ, agent, {}, undefined, true))).toBeNull();
    expect(eventForEndpointCall(call(EDIT, agent, {}, undefined, true))).toMatchObject({ action: "docs_editDoc" });
  });

  it("leaves out a request with no caller", () => {
    expect(eventForEndpointCall(call(READ, null, { status: 401 }))).toBeNull();
  });
});

describe("eventForMcpEvent", () => {
  it("records a hello and a tool listing as done", () => {
    expect(eventForMcpEvent(agent, "claude-ai", "initialize")).toEqual({
      ownerId: "u1",
      actor: { kind: "agent", keyId: "k1", provider: "claude_desktop", client: "claude-ai" },
      channel: "mcp",
      action: "mcp.initialize",
      detail: null,
      outcome: "success",
    });
    expect(eventForMcpEvent(agent, null, "tools_list")).toMatchObject({ action: "mcp.tools_list", outcome: "success" });
  });

  it("records a tool or a method that is not there as an error", () => {
    expect(eventForMcpEvent(agent, null, "unknown_tool", "docs_dropEverything")).toMatchObject({
      action: "mcp.unknown_tool",
      detail: "docs_dropEverything",
      outcome: "error",
    });
    expect(eventForMcpEvent(agent, null, "unknown_method", "resources/list")).toMatchObject({
      action: "mcp.unknown_method",
      detail: "resources/list",
      outcome: "error",
    });
  });
});

describe("what a create made", () => {
  const CREATE_DOC: EndpointDef = { id: "docs_createDoc", method: "POST", path: "/docs", scope: "write", summary: "Create" };
  const CREATE_VAULT: EndpointDef = { id: "docs_createVault", method: "POST", path: "/vaults", scope: "write", summary: "Create" };

  it("reads the new document and its vault from a document create's answer", async () => {
    const created = createdIdsOf(call(CREATE_DOC, person, { status: 201, readBody: async () => ({ doc: { id: "d9", vault_id: "v9", title: "T" } }) }));
    expect(await created).toEqual({ docId: "d9", vaultId: "v9" });
  });

  it("reads the new vault from a vault create's answer", async () => {
    expect(await createdIdsOf(call(CREATE_VAULT, person, { status: 201, readBody: async () => ({ vault: { id: "v1" } }) }))).toEqual({ vaultId: "v1" });
  });

  it("does not read the answer of anything that is not a create that worked", () => {
    let asked = 0;
    const readBody = async () => (asked++, null);
    expect(createdIdsOf(call(READ, person, { readBody }))).toBeNull();
    expect(createdIdsOf(call(EDIT, person, { readBody }))).toBeNull();
    expect(createdIdsOf(call(CREATE_DOC, person, { status: 400, readBody }))).toBeNull();
    expect(asked).toBe(0);
  });

  it("finds nothing in an answer that is not the shape it expects", () => {
    const bodies: JsonValue[] = [null, "x", [], { doc: "d1" }, { doc: { id: 3 } }, { vault: {} }];
    for (const body of bodies) expect(createdIdsIn(body)).toEqual({});
  });
});
