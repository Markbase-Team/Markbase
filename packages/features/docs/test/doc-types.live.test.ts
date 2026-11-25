import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { configureSupabase } from "@markbase/server/supabase";
import { CALLER_HEADER, serializeCaller, type Caller } from "@markbase/shared/auth";
import { base64ToBytes, bytesToBase64 } from "@markbase/shared/docs/crdt-supabase";
import { getMarkdown, setMarkdown } from "@markbase/shared/docs/crdt";
import { restore, snapshot } from "@markbase/shared/docs/sync";

// Doc types end to end against a real Supabase: the migrations' tables and
// functions, the server code and the endpoints, with nothing mocked. Runs only
// when a Supabase is configured (`supabase start`, then SUPABASE_URL and
// SUPABASE_KEY, the SECRET key, as the server uses it); skips in plain CI.
//
// Two people, Jessie and Sam, each with an account. Jessie's tasks and a doc
// she shares with Sam; then everything Today, confirmations and the property
// index have to get right, through the same endpoints the app and agents use.

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_KEY;

describe.skipIf(!URL || !KEY)("doc types against a real Supabase (live)", () => {
  let admin: SupabaseClient;
  let jessie: string;
  let sam: string;
  const made: string[] = [];
  const run = Date.now().toString(36);

  let H: typeof import("../src/handlers");

  const person = (id: string, email: string): Caller => ({ via: "session", ownerId: id, email });
  const claude = (id: string): Caller => ({ via: "api_key", ownerId: id, key: { id: `key-${run}`, provider: "claude_code", capability: null } });

  type Ep = { handle: (req: Request, params: Record<string, string>) => Promise<Response> };
  async function call(ep: Ep, caller: Caller, opts: { id?: string; query?: string; body?: unknown } = {}) {
    const method = opts.body === undefined ? "GET" : "POST";
    const req = new Request(`https://markbase.local/api/v1/x${opts.query ?? ""}`, {
      method,
      headers: { [CALLER_HEADER]: serializeCaller(caller), "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify(opts.body) : undefined,
    });
    const res = await ep.handle(req, opts.id ? { id: opts.id } : {});
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json as Record<string, unknown> };
  }

  async function create(caller: Caller, title: string, content: string): Promise<string> {
    const { status, body } = await call(H.createDocEndpoint, caller, { body: { title, content } });
    expect(status, JSON.stringify(body)).toBe(201);
    const id = (body.doc as { id: string }).id;
    made.push(id);
    return id;
  }

  async function properties(docId: string) {
    const { data, error } = await admin.schema("docs").from("documents").select("properties").eq("id", docId).single();
    if (error) throw error;
    return data.properties as Record<string, unknown>;
  }

  async function today(caller: Caller) {
    const { status, body } = await call(H.queryViewEndpoint, caller, { query: "?view=today&tz=America/Los_Angeles" });
    expect(status, JSON.stringify(body)).toBe(200);
    return body as unknown as { rows: { id: string; title: string }[]; groups: { key: string; rows: { title: string }[] }[]; today: string };
  }

  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    configureSupabase(URL!, KEY!);
    admin = createClient(URL!, KEY!, { auth: { persistSession: false } });
    const make = async (name: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `${name}-${run}@example.com`,
        password: `pw-${run}-${name}-Aa1!`,
        email_confirm: true,
        user_metadata: { display_name: name[0].toUpperCase() + name.slice(1) },
      });
      if (error) throw error;
      return data.user.id;
    };
    jessie = await make("jessie");
    sam = await make("sam");
    H = await import("../src/handlers");
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;
    if (made.length) await admin.schema("docs").from("documents").delete().in("id", made);
    for (const id of [jessie, sam].filter(Boolean)) {
      await admin.schema("docs").from("vaults").delete().eq("owner_id", id);
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("indexes a new document's front matter, typed, on creation", async () => {
    const J = person(jessie, `jessie-${run}@example.com`);
    const id = await create(J, "Indexed", `---\ntype: incident\nseverity: sev1\nlast_drill: 2026-09-01\ntags: [db, oncall]\n---\n\n# Indexed\n`);
    expect(await properties(id)).toEqual({ type: "incident", severity: "sev1", last_drill: "2026-09-01", tags: ["db", "oncall"] });
    const { data } = await admin.schema("docs").from("doc_properties").select("key, v_text, v_date").eq("doc_id", id).order("key").order("v_text");
    expect(data).toEqual([
      { key: "last_drill", v_text: "2026-09-01", v_date: "2026-09-01T00:00:00+00:00" },
      { key: "severity", v_text: "sev1", v_date: null },
      { key: "tags", v_text: "db", v_date: null },
      { key: "tags", v_text: "oncall", v_date: null },
      { key: "type", v_text: "incident", v_date: null },
    ]);
  });

  it("shows each person their own Today, and an agent its own", async () => {
    const J = person(jessie, `jessie-${run}@example.com`);
    const S = person(sam, `sam-${run}@example.com`);
    const due = await create(J, `Due tomorrow ${run}`, `---\ntype: task\ndue: ${day(1)}\n---\n\nShip it.\n`);
    await create(J, `Late ${run}`, `---\ntype: task\nassignee: human:${jessie}\ndue: ${day(-3)}\n---\n`);
    await create(J, `Someday ${run}`, `---\ntype: task\n---\n`);
    await create(J, `Too far ${run}`, `---\ntype: task\ndue: ${day(40)}\n---\n`);
    await create(J, `Already done ${run}`, `---\ntype: task\ndone: true\n---\n`);
    await create(J, `For Sam, not shared ${run}`, `---\ntype: task\nassignee: human:${sam}\n---\n`);
    await create(J, `For Claude ${run}`, `---\ntype: task\nassignee: agent:claude\n---\n`);
    await create(J, `Not a task ${run}`, `---\ndue: ${day(1)}\n---\n`);
    const shared = await create(J, `For Sam, shared ${run}`, `---\ntype: task\nassignee: human:${sam}\ndue: ${day(0)}\n---\n`);
    const { error } = await admin.schema("docs").from("members").insert({ doc_id: shared, user_id: sam, capability: "editor" });
    if (error) throw error;

    const mine = await today(J);
    const titles = mine.rows.map((r) => r.title).filter((t) => t.endsWith(run));
    expect(titles).toEqual([`Late ${run}`, `Due tomorrow ${run}`, `Someday ${run}`]);
    expect(mine.groups.map((g) => g.key).filter((k) => ["overdue", "none"].includes(k))).toEqual(["overdue", "none"]);

    const sams = (await today(S)).rows.map((r) => r.title);
    expect(sams).toEqual([`For Sam, shared ${run}`]);

    const agent = (await today(claude(jessie))).rows.map((r) => r.title);
    expect(agent).toEqual([`For Claude ${run}`]);

    // The date is still the date that was written, not a timestamp.
    const content = async () => ((await call(H.readDocEndpoint, J, { id: due })).body.doc as { content: string }).content;
    const before = await content();
    expect(before).toContain(`due: ${day(1)}\n`);

    // Ticking one done: one line of front matter, and it leaves Today.
    const set = await call(H.setPropertyEndpoint, J, { id: due, body: { key: "done", value: true } });
    expect(set.status).toBe(200);
    expect(await content()).toBe(before.replace(`due: ${day(1)}\n`, `due: ${day(1)}\ndone: true\n`));
    expect(await properties(due)).toMatchObject({ done: true });
    expect((await today(J)).rows.map((r) => r.title)).not.toContain(`Due tomorrow ${run}`);

    // Sam can't touch a document of Jessie's he wasn't given.
    const notShared = (await today(J)).rows.find((r) => r.title === `Late ${run}`)!.id;
    expect((await call(H.setPropertyEndpoint, S, { id: notShared, body: { key: "done", value: true } })).status).toBe(404);
  }, 60_000);

  it("narrows an inline view by the property index, for any team field", async () => {
    const J = person(jessie, `jessie-${run}@example.com`);
    const spec = { filter: { all: [{ field: "type", op: "eq", value: "incident" }, { field: "severity", op: "eq", value: "sev1" }] }, columns: ["$title", "tags"] };
    const { status, body } = await call(H.queryViewEndpoint, J, { query: `?spec=${encodeURIComponent(JSON.stringify(spec))}` });
    expect(status).toBe(200);
    const rows = (body.rows as { title: string; fields: Record<string, unknown> }[]).filter((r) => r.title === "Indexed");
    expect(rows).toEqual([expect.objectContaining({ fields: { $title: "Indexed", tags: ["db", "oncall"] } })]);
  });

  it("indexes what the editor saves, not only what the API writes", async () => {
    const J = person(jessie, `jessie-${run}@example.com`);
    const id = await create(J, `Edited in the editor ${run}`, `# Notes\n`);
    // Load the stored state (creating it), change the text as a browser would, save the snapshot.
    const first = await call(H.readCrdtEndpoint, J, { id });
    let state = first.body.state as string | null;
    if (!state) {
      await call(H.readDocEndpoint, J, { id });
      await call(H.setPropertyEndpoint, J, { id, body: { key: "draft", value: true } });
      state = (await call(H.readCrdtEndpoint, J, { id })).body.state as string;
    }
    const ydoc = restore(base64ToBytes(state));
    setMarkdown(ydoc, `---\ntype: task\npriority: 2\n---\n\n${getMarkdown(ydoc).replace(/^---[\s\S]*?---\n\n?/, "")}`);
    const saved = await call(H.writeCrdtEndpoint, J, { id, body: { state: bytesToBase64(snapshot(ydoc)) } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(await properties(id)).toEqual({ type: "task", priority: 2 });
  });

  it("records confirmations in their table, refuses confirming your own change, and ends them on an edit", async () => {
    const J = person(jessie, `jessie-${run}@example.com`);
    const S = person(sam, `sam-${run}@example.com`);
    const id = await create(J, `Runbook ${run}`, `# Runbook\n\nRestart the worker.\n`);
    await admin.schema("docs").from("members").insert({ doc_id: id, user_id: sam, capability: "editor" });

    // Jessie wrote it, so Jessie can't vouch for it; Sam can.
    expect((await call(H.verifyDocEndpoint, J, { id, body: {} })).status).toBe(409);
    const ok = await call(H.verifyDocEndpoint, S, { id, body: {} });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.trust).toBe("human_confirmed");
    const { data: rows } = await admin.schema("docs").from("doc_confirmations").select("actor, user_id").eq("doc_id", id);
    expect(rows).toEqual([{ actor: `human:${sam}`, user_id: sam }]);

    // A confirmation typed into front matter doesn't count.
    await call(H.setPropertyEndpoint, J, { id, body: { key: "status", value: "stable" } });
    expect((await call(H.setPropertyEndpoint, J, { id, body: { key: "verified", value: [{ by: `human:${jessie}`, at: "2099-01-01" }] } })).status).toBe(400);

    // Front matter changes aren't meaningful: Sam's confirmation stands.
    expect((await call(H.docStatusEndpoint, J, { id })).body.trust).toBe("human_confirmed");

    // An agent changes the words: it ends.
    await new Promise((r) => setTimeout(r, 1100));
    const edit = await call(H.editDocEndpoint, claude(jessie), { id, body: { quote: "Restart the worker.", insert: "Restart the server." } });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const after = await call(H.docStatusEndpoint, J, { id });
    expect(after.body.trust).toBe("unverified");
  }, 30_000);

  it("keeps the confirmations and property tables closed to the public key", async () => {
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!anonKey) return;
    const anon = createClient(URL!, anonKey, { auth: { persistSession: false } });
    for (const table of ["doc_confirmations", "doc_properties"]) {
      const { error } = await anon.schema("docs").from(table).select("*").limit(1);
      expect(error, table).not.toBeNull();
    }
    const { error } = await anon.schema("docs").rpc("query_documents", { me: jessie, contains: {}, max_rows: 1 });
    expect(error).not.toBeNull();
  });
});
