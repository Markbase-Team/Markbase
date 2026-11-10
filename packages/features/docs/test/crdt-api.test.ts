import { describe, it, expect, vi } from "vitest";
import { ApiCrdtTransport, bearerCrdtRequest, type CrdtRequest } from "../src/logic/crdt-api";
import { bytesToBase64 } from "../src/logic/crdt-supabase";

// The client half of the stage-2 transport, against a scripted API. What the
// daemon relies on: that a save lands, that a failure is retried when it is the
// server's and reported when it is ours, and that an edit made elsewhere reaches
// a subscriber through the poll — and that its own save does not.

const bytes = (...b: number[]) => new Uint8Array(b);

interface Call {
  method: string;
  path: string;
  body?: string;
}

/** A fake API: a cloud of snapshots with versions, a change log, and a script of failures. */
class FakeApi {
  readonly calls: Call[] = [];
  readonly cloud = new Map<string, { state: Uint8Array; version: number; at: number }>();
  /** Status to answer the next N matching requests with, instead of the real thing. */
  readonly failNext: Array<{ match: RegExp; status: number }> = [];
  clock = 1000;

  bump(docId: string, state: Uint8Array): void {
    const prev = this.cloud.get(docId);
    this.cloud.set(docId, { state, version: (prev?.version ?? 0) + 1, at: ++this.clock });
  }

  request: CrdtRequest = async (path, init = {}) => {
    const method = init.method ?? "GET";
    this.calls.push({ method, path, body: init.body });
    const fail = this.failNext.findIndex((f) => f.match.test(path));
    if (fail >= 0) {
      const [f] = this.failNext.splice(fail, 1);
      return new Response("nope", { status: f.status });
    }
    const url = new URL(path, "http://api.test");
    if (url.pathname === "/api/v1/docs/crdt/changes") {
      const since = url.searchParams.get("since");
      if (!since) return Response.json({ cursor: String(this.clock), changes: [] });
      const from = Number(since);
      const rows = [...this.cloud.entries()]
        .filter(([, v]) => v.at > from)
        .sort((a, b) => a[1].at - b[1].at);
      return Response.json({
        cursor: rows.length ? String(rows[rows.length - 1][1].at) : since,
        changes: rows.map(([doc_id, v]) => ({ doc_id, version: v.version })),
      });
    }
    const m = url.pathname.match(/^\/api\/v1\/docs\/([^/]+)\/crdt$/);
    if (!m) return new Response("not found", { status: 404 });
    const docId = m[1];
    if (method === "POST") {
      const { state } = JSON.parse(init.body ?? "{}") as { state: string };
      this.bump(docId, Uint8Array.from(atob(state), (c) => c.charCodeAt(0)));
      return Response.json({ version: this.cloud.get(docId)!.version });
    }
    const row = this.cloud.get(docId);
    if (!row) return Response.json({ state: null, version: 0 });
    const after = url.searchParams.get("after");
    if (after !== null && Number(after) >= row.version) {
      return Response.json({ version: row.version, unchanged: true });
    }
    return Response.json({ state: bytesToBase64(row.state), version: row.version });
  };
}

describe("ApiCrdtTransport store", () => {
  it("loads null for a document the cloud has no snapshot for, and the state otherwise", async () => {
    const api = new FakeApi();
    const t = new ApiCrdtTransport(api.request);
    expect(await t.store.load("d1")).toBeNull();
    api.bump("d1", bytes(1, 2, 3));
    expect(await t.store.load("d1")).toEqual(bytes(1, 2, 3));
    t.close();
  });

  it("saves through POST and the cloud holds it", async () => {
    const api = new FakeApi();
    const t = new ApiCrdtTransport(api.request);
    await t.store.save("d1", bytes(9, 9));
    expect(api.cloud.get("d1")?.state).toEqual(bytes(9, 9));
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    t.close();
  });

  it("retries a save the server could not take, and reports one it refused", async () => {
    const api = new FakeApi();
    const retries: number[] = [];
    const t = new ApiCrdtTransport(api.request, { onRetry: (n) => retries.push(n) });
    // A 503 is the server's problem: tried again, and it lands.
    api.failNext.push({ match: /\/d1\/crdt$/, status: 503 });
    await t.store.save("d1", bytes(1));
    expect(api.cloud.get("d1")?.state).toEqual(bytes(1));
    expect(retries).toEqual([1]);
    // A 403 is ours: said at once, never retried.
    api.failNext.push({ match: /\/d2\/crdt$/, status: 403 });
    await expect(t.store.save("d2", bytes(1))).rejects.toThrow(/403/);
    expect(api.calls.filter((c) => c.path.includes("/d2/crdt"))).toHaveLength(1);
    t.close();
  });
});

describe("ApiCrdtTransport pub/sub (the change feed)", () => {
  it("delivers a snapshot that changed elsewhere, and not one it saved itself", async () => {
    const api = new FakeApi();
    const t = new ApiCrdtTransport(api.request, { pollMs: 60_000 });
    api.bump("d1", bytes(1));
    await t.store.load("d1");
    const got: Uint8Array[] = [];
    t.pubsub.subscribe("d1", (u) => got.push(u));

    // Our own save: the feed reports it, the poll skips it.
    await t.store.save("d1", bytes(2));
    await t.poll();
    expect(got).toEqual([]);

    // Someone else's save: fetched and handed over.
    api.bump("d1", bytes(3));
    await t.poll();
    expect(got).toEqual([bytes(3)]);

    // Nothing new: nothing fetched.
    const fetches = api.calls.filter((c) => c.method === "GET" && /\/d1\/crdt$/.test(c.path)).length;
    await t.poll();
    expect(api.calls.filter((c) => c.method === "GET" && /\/d1\/crdt$/.test(c.path)).length).toBe(fetches);
    t.close();
  });

  it("establishes the cursor before the first load, so nothing slips between them", async () => {
    const api = new FakeApi();
    const t = new ApiCrdtTransport(api.request, { pollMs: 60_000 });
    api.bump("d1", bytes(1));
    await t.store.load("d1");
    const [first] = api.calls;
    expect(first.path).toMatch(/\/docs\/crdt\/changes$/); // the cursor, with no `since`
    t.close();
  });

  it("ignores changes to documents nobody here subscribed to", async () => {
    const api = new FakeApi();
    const t = new ApiCrdtTransport(api.request, { pollMs: 60_000 });
    await t.store.load("d1");
    const got: Uint8Array[] = [];
    t.pubsub.subscribe("d1", (u) => got.push(u));
    api.bump("other", bytes(7));
    await t.poll();
    expect(got).toEqual([]);
    expect(api.calls.some((c) => c.path.includes("/other/crdt"))).toBe(false);
    t.close();
  });

  it("scopes the feed to the vault it was given", async () => {
    const api = new FakeApi();
    const t = new ApiCrdtTransport(api.request, { vaultId: "v9", pollMs: 60_000 });
    await t.store.load("d1");
    expect(api.calls[0].path).toContain("vault=v9");
    t.close();
  });

  it("scopes the feed to the shared documents for a Shared Vault, and not to a vault as well", async () => {
    const api = new FakeApi();
    const t = new ApiCrdtTransport(api.request, { scope: "shared", pollMs: 60_000 });
    await t.store.load("d1");
    expect(api.calls[0].path).toContain("scope=shared");
    expect(api.calls[0].path).not.toContain("vault=");
    t.close();
    expect(() => new ApiCrdtTransport(api.request, { scope: "shared", vaultId: "v9" })).toThrow(
      /one vault or to the shared/
    );
  });

  it("a poll that fails is reported and does not stop the next one", async () => {
    const api = new FakeApi();
    const log = vi.fn();
    const t = new ApiCrdtTransport(api.request, { pollMs: 60_000, log });
    await t.store.load("d1");
    const got: Uint8Array[] = [];
    t.pubsub.subscribe("d1", (u) => got.push(u));
    api.failNext.push({ match: /changes/, status: 500 });
    await t.poll();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("500"));
    api.bump("d1", bytes(5));
    await t.poll();
    expect(got).toEqual([bytes(5)]);
    t.close();
  });

  it("per-document mode asks each subscribed document with `after`, for a caller with no account", async () => {
    const api = new FakeApi();
    const t = new ApiCrdtTransport(api.request, { perDoc: true, pollMs: 60_000 });
    api.bump("d1", bytes(1));
    await t.store.load("d1");
    expect(api.calls.some((c) => c.path.includes("/changes"))).toBe(false);
    const got: Uint8Array[] = [];
    t.pubsub.subscribe("d1", (u) => got.push(u));
    await t.poll();
    expect(got).toEqual([]);
    expect(api.calls.at(-1)?.path).toBe("/api/v1/docs/d1/crdt?after=1");
    api.bump("d1", bytes(2));
    await t.poll();
    expect(got).toEqual([bytes(2)]);
    t.close();
  });

  it("stops polling once the last subscriber leaves", async () => {
    const api = new FakeApi();
    const t = new ApiCrdtTransport(api.request, { pollMs: 5 });
    await t.store.load("d1");
    const off = t.pubsub.subscribe("d1", () => {});
    await new Promise((r) => setTimeout(r, 30));
    const polled = api.calls.filter((c) => c.path.includes("since=")).length;
    expect(polled).toBeGreaterThan(0);
    off();
    await new Promise((r) => setTimeout(r, 30));
    expect(api.calls.filter((c) => c.path.includes("since=")).length).toBe(polled);
    t.close();
  });
});

describe("bearerCrdtRequest", () => {
  it("prefixes the app URL and attaches the key it reads at call time", async () => {
    const seen: Array<{ url: string; auth: string | undefined }> = [];
    let key: string | null = null;
    const request = bearerCrdtRequest(
      "https://markbase.so/",
      () => key,
      async (url, init) => {
        seen.push({ url, auth: (init.headers as Record<string, string>).Authorization });
        return new Response("{}");
      }
    );
    await request("/api/v1/docs/d1/crdt");
    key = "jsk_abc";
    await request("/api/v1/docs/d1/crdt", { method: "POST", body: "{}" });
    expect(seen).toEqual([
      { url: "https://markbase.so/api/v1/docs/d1/crdt", auth: undefined },
      { url: "https://markbase.so/api/v1/docs/d1/crdt", auth: "Bearer jsk_abc" },
    ]);
  });
});
