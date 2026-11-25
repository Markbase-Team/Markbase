import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/shared/auth";
import { createDoc, getMarkdown, type ViewDoc } from "@markbase/shared/docs";
import type { Doc as YDoc } from "yjs";

// docs_queryView and docs_setProperty. The candidate query is a database
// function (checked against Postgres separately); here it is a stand-in, and
// what is under test is what each endpoint asks of it, how a view is chosen
// or refused, and what setting a property does to the document.

const queryDocuments = vi.fn();
let doc: YDoc;
let edits: { label?: string }[];

const ROW = { id: "doc_1", title: "Update the runbook", owner_id: "owner_1", tab_group_id: "doc_1", version: 1, content: "" };

vi.mock("../src/server/query-documents", () => ({ queryDocuments: (input: unknown) => queryDocuments(input) }));
vi.mock("../src/server/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/documents")>()),
  getDocument: async (id: string) => (id === "doc_1" ? ROW : null),
}));
vi.mock("../src/server/doc-crdt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/doc-crdt")>()),
  readDocCrdt: async (_id: string, _seed: string, fn: (d: YDoc) => unknown) => fn(doc),
  editDocCrdt: async (_id: string, _seed: string, by: { label?: string }, fn: (d: YDoc) => unknown) => {
    edits.push(by);
    const result = fn(doc);
    return { result, markdown: getMarkdown(doc), docJson: null };
  },
}));
vi.mock("../src/server/members", () => ({
  getMemberCapability: async (_d: string, u: string) => (u === "viewer_1" ? "viewer" : null),
  setMemberPath: async () => true,
  removeMember: async () => true,
}));
vi.mock("../src/server/links", () => ({ getLinkByToken: async () => null }));
vi.mock("../src/server/owner-name", () => ({ ownerDisplayName: async () => "Jessie" }));
vi.mock("@markbase/server/db/agent-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/agent-sessions")>()),
  claimAgentSession: async () => null,
}));

const { queryViewEndpoint, setPropertyEndpoint } = await import("../src/handlers/views");

const PERSON: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };
const VIEWER: Caller = { via: "session", ownerId: "viewer_1", email: "v@example.com" };
const AGENT: Caller = { via: "api_key", ownerId: "owner_1", key: { id: "key_1", provider: "claude_code", capability: null } };

const task = (title: string, properties: ViewDoc["properties"]): ViewDoc => ({
  id: title, title, path: null, vault_id: "v1", owner_id: "owner_1", updated_at: "2026-11-20T00:00:00Z", properties,
});

function query(caller: Caller, q: string): Promise<Response> {
  const req = new Request(`https://markbase.so/api/v1/docs/views?${q}`, { headers: { [CALLER_HEADER]: serializeCaller(caller) } });
  return queryViewEndpoint.handle(req, {});
}
function setProp(caller: Caller, body: unknown): Promise<Response> {
  const req = new Request("https://markbase.so/api/v1/docs/doc_1/properties", {
    method: "POST",
    headers: { [CALLER_HEADER]: serializeCaller(caller), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return setPropertyEndpoint.handle(req, { id: "doc_1" });
}

const TASK = "---\ntype: task\n# for the oncall\nassignee: human:owner_1\ndue: 2026-11-28\ndone: false\n---\n\nUpdate the runbook.\n";

beforeEach(() => {
  vi.useRealTimers();
  queryDocuments.mockReset().mockResolvedValue([]);
  doc = createDoc(TASK);
  edits = [];
});

describe("docs_queryView", () => {
  it("runs the built-in Today view for a person, narrowing candidates to tasks", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T05:00:00Z"));
    queryDocuments.mockResolvedValue([
      task("Late", { type: "task", due: "2026-11-24" }),
      task("Someone else's", { type: "task", assignee: "human:sam" }),
      task("Done", { type: "task", done: true }),
    ]);
    const body = await (await query(PERSON, "view=today&tz=America/Los_Angeles")).json();
    expect(queryDocuments).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner_1", contains: { type: "task" } }));
    expect(body.today).toBe("2026-11-25");
    expect(body.rows.map((r: { title: string }) => r.title)).toEqual(["Late"]);
    expect(body.groups).toEqual([{ key: "overdue", rows: body.rows }]);
    expect(body.truncated).toBe(false);
  });

  it("is the same view for an agent: its $me is itself", async () => {
    queryDocuments.mockResolvedValue([
      task("For the agent", { type: "task", assignee: "agent:claude" }),
      task("For another agent", { type: "task", assignee: "agent:codex" }),
      task("Unassigned", { type: "task" }),
    ]);
    const body = await (await query(AGENT, "view=today")).json();
    expect(body.rows.map((r: { title: string }) => r.title)).toEqual(["For the agent"]);
  });

  it("runs a view given inline, pushing its literal equalities to the index", async () => {
    queryDocuments.mockResolvedValue([task("DB failover", { type: "incident", severity: "sev1" }), task("Cache", { type: "incident", severity: "sev2" })]);
    const spec = { filter: { all: [{ field: "type", op: "eq", value: "incident" }, { field: "severity", op: "eq", value: "sev1" }] } };
    const body = await (await query(PERSON, `spec=${encodeURIComponent(JSON.stringify(spec))}`)).json();
    expect(queryDocuments).toHaveBeenCalledWith(expect.objectContaining({ contains: { type: "incident", severity: "sev1" } }));
    expect(body.name).toBe("custom");
    expect(body.rows.map((r: { title: string }) => r.title)).toEqual(["DB failover"]);
  });

  it("refuses an unknown view, a bad spec, and no view at all", async () => {
    expect((await query(PERSON, "view=nope")).status).toBe(404);
    expect((await query(PERSON, "spec=%7Bnot%20json")).status).toBe(400);
    const bad = await query(PERSON, `spec=${encodeURIComponent(JSON.stringify({ filter: { field: "a", op: "like" } }))}`);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("op must be");
    expect((await query(PERSON, "")).status).toBe(400);
    expect(queryDocuments).not.toHaveBeenCalled();
  });

  it("says when there were more candidates than it looked at", async () => {
    queryDocuments.mockResolvedValue(Array.from({ length: 2000 }, (_, i) => task(`T${i}`, { type: "task" })));
    expect((await (await query(PERSON, "view=today")).json()).truncated).toBe(true);
  });
});

describe("docs_setProperty", () => {
  it("marks a task done by changing that one line, in the caller's name", async () => {
    const res = await setProp(PERSON, { key: "done", value: true });
    expect(res.status).toBe(200);
    expect(getMarkdown(doc)).toBe(TASK.replace("done: false", "done: true"));
    expect(edits).toEqual([expect.objectContaining({ label: "Set done" })]);
  });

  it("sets any field, adding it when it isn't there, and writes nothing when unchanged", async () => {
    await setProp(PERSON, { key: "tags", value: ["oncall", "db"] });
    expect(getMarkdown(doc)).toContain("tags:\n  - oncall\n  - db\n---");
    edits = [];
    await setProp(PERSON, { key: "done", value: false });
    expect(edits).toEqual([]);
  });

  it("refuses verified, a bad key, a missing value, and a reader", async () => {
    expect((await setProp(PERSON, { key: "verified", value: [] })).status).toBe(400);
    expect((await setProp(PERSON, { key: "a b", value: 1 })).status).toBe(400);
    expect((await setProp(PERSON, { key: "done" })).status).toBe(400);
    expect((await setProp(VIEWER, { key: "done", value: true })).status).toBe(403);
    expect(getMarkdown(doc)).toBe(TASK);
  });
});
