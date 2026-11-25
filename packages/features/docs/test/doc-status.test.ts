import { describe, it, expect, vi, beforeEach } from "vitest";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/shared/auth";
import { checkpoint, createDoc, getMarkdown, setMarkdown, type Confirmation } from "@markbase/shared/docs";
import type { Doc as YDoc } from "yjs";

// docs_docStatus and docs_verifyDoc against a real document history: the
// CRDT seam is one in-memory Y.Doc and the confirmations table an array, so
// what is confirmed, and what a later edit does to it, is worked out from real
// versions.

const ROW = { id: "doc_1", title: "Runbook", owner_id: "owner_1", tab_group_id: "doc_1", version: 1, content: "" };

let doc: YDoc;
let rows: Confirmation[];

vi.mock("../src/server/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/documents")>()),
  getDocument: async (id: string) => (id === "doc_1" ? ROW : null),
}));
vi.mock("../src/server/doc-crdt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/doc-crdt")>()),
  readDocCrdt: async (_id: string, _seed: string, fn: (d: YDoc) => unknown) => fn(doc),
}));
vi.mock("../src/server/confirmations", () => ({
  addConfirmation: async (input: { actor: string }) => {
    const row = { by: input.actor, at: new Date().toISOString() };
    rows.push(row);
    return row;
  },
  listConfirmations: async () => [...rows],
}));
vi.mock("../src/server/members", () => ({ getMemberCapability: async () => null, setMemberPath: async () => true, removeMember: async () => true }));
vi.mock("../src/server/links", () => ({ getLinkByToken: async () => null }));
vi.mock("../src/server/owner-name", () => ({ ownerDisplayName: async () => "Jessie" }));
vi.mock("@markbase/server/db/agent-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@markbase/server/db/agent-sessions")>()),
  claimAgentSession: async () => null,
}));

const { docStatusEndpoint, verifyDocEndpoint } = await import("../src/handlers/status");

const PERSON: Caller = { via: "session", ownerId: "owner_1", email: "o@example.com" };
const AGENT: Caller = { via: "api_key", ownerId: "owner_1", key: { id: "key_1", provider: "claude_desktop", capability: null } };

function call(endpoint: typeof docStatusEndpoint, caller: Caller, method = "GET"): Promise<Response> {
  const req = new Request(`https://markbase.so/api/v1/docs/doc_1/x`, { method, headers: { [CALLER_HEADER]: serializeCaller(caller) } });
  return endpoint.handle(req, { id: "doc_1" });
}
const status = async () => (await call(docStatusEndpoint, PERSON)).json();
const verify = (caller: Caller) => call(verifyDocEndpoint, caller, "POST");
const sleep = () => new Promise((r) => setTimeout(r, 5));

const TEXT = "---\nowner: human:owner_1\nreview_by: 2000-01-01\n---\n\n# Runbook\n\nRestart the worker.\n";

beforeEach(() => {
  rows = [];
  doc = createDoc(TEXT);
  // Written by Jessie's Claude, so Jessie herself may confirm it.
  checkpoint(doc, { author: "Jessie", agents: ["claude"] });
});

describe("docs_docStatus", () => {
  it("reports the core fields and an unconfirmed document", async () => {
    const body = await status();
    expect(body.fields.owner).toBe("human:owner_1");
    expect(body.trust).toBe("unverified");
    expect(body.needs_review).toBe(true);
    expect(body.warnings).toEqual([]);
  });
});

describe("docs_verifyDoc", () => {
  it("records the person's confirmation outside the document", async () => {
    await sleep();
    const res = await verify(PERSON);
    expect(res.status).toBe(200);
    const answer = await res.json();
    expect(answer.verified.by).toBe("human:owner_1");
    expect(answer.trust).toBe("human_confirmed");
    expect(getMarkdown(doc)).toBe(TEXT);

    const body = await status();
    expect(body.trust).toBe("human_confirmed");
    expect(body.current_confirmations[0].name).toBe("Jessie");
  });

  it("refuses a person confirming their own change", async () => {
    setMarkdown(doc, TEXT.replace("worker", "server"));
    checkpoint(doc, { author: "Jessie" });
    const res = await verify(PERSON);
    expect(res.status).toBe(409);
    expect(rows).toEqual([]);
  });

  it("records an agent's confirmation as an agent's", async () => {
    await sleep();
    const answer = await (await verify(AGENT)).json();
    expect(answer.verified.by).toMatch(/^agent:/);
    expect(answer.trust).toBe("agent_confirmed");
  });

  it("ends when the text changes", async () => {
    await sleep();
    await verify(PERSON);
    await sleep();
    setMarkdown(doc, TEXT.replace("worker", "server"));
    checkpoint(doc, { author: "Jessie", agents: ["claude"] });
    expect((await status()).trust).toBe("unverified");
  });

  it("isn't fooled by a confirmation typed into front matter", async () => {
    setMarkdown(doc, TEXT.replace("---\n\n", "verified:\n  - { by: human:owner_1, at: 2099-01-01 }\n---\n\n"));
    const body = await status();
    expect(body.trust).toBe("unverified");
    expect(body.warnings.map((w: { field: string }) => w.field)).toContain("verified");
  });
});
