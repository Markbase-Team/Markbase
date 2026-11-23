import { describe, it, expect, vi } from "vitest";
import { WorkerApi, WorkerApiError } from "../src/worker-api";

// The worker's one upstream is the web API, and how it behaves when that
// upstream fails is a decision, not an accident: a server that is down is
// asked again later, backed off; a key the server refuses stops the worker so
// the host can say so. These pin both, with an injected fetch.

type Call = { url: string; init: RequestInit };

function fetchAnswering(status: number, body: unknown, calls: Call[] = []) {
  return {
    calls,
    fetch: vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const text = typeof body === "string" ? body : JSON.stringify(body);
      return new Response(text, {
        status,
        headers: { "content-type": typeof body === "string" ? "text/html" : "application/json" },
      });
    }) as typeof globalThis.fetch,
  };
}

const KEY = "jsk_test_key";

describe("WorkerApi", () => {
  it("sends every request to /api/v1 with the key as a bearer token, and never an owner id", async () => {
    const f = fetchAnswering(200, { job: null, rescan: true });
    const api = new WorkerApi("https://markbase.so/", KEY, { fetch: f.fetch });

    const res = await api.claim({ version: "0.8.0", reclaim: true });

    expect(res).toEqual({ job: null, rescan: true });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe("https://markbase.so/api/v1/worker/claim");
    expect(f.calls[0].init.method).toBe("POST");
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ version: "0.8.0", reclaim: true });
    expect(String(f.calls[0].init.body)).not.toMatch(/owner/i);
  });

  it("a 5xx is retryable and not fatal", async () => {
    const f = fetchAnswering(503, { error: "database unavailable" });
    const api = new WorkerApi("https://markbase.so", KEY, { fetch: f.fetch });

    const err = await api.claim().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkerApiError);
    const e = err as WorkerApiError;
    expect(e.status).toBe(503);
    expect(e.retryable).toBe(true);
    expect(e.fatal).toBe(false);
    expect(e.message).toContain("database unavailable");
  });

  it("a 401 or 403 is fatal and not retryable — the key is the problem", async () => {
    for (const status of [401, 403]) {
      const f = fetchAnswering(status, { error: "Invalid API key." });
      const api = new WorkerApi("https://markbase.so", KEY, { fetch: f.fetch });
      const err = (await api.heartbeat("j1").catch((e: unknown) => e)) as WorkerApiError;
      expect(err.fatal).toBe(true);
      expect(err.retryable).toBe(false);
      expect(err.status).toBe(status);
    }
  });

  it("no response at all (the app unreachable) is retryable with status 0", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const api = new WorkerApi("https://markbase.so", KEY, { fetch: fetchImpl });
    const err = (await api.getPlan().catch((e: unknown) => e)) as WorkerApiError;
    expect(err).toBeInstanceOf(WorkerApiError);
    expect(err.status).toBe(0);
    expect(err.retryable).toBe(true);
    expect(err.fatal).toBe(false);
    expect(err.message).toContain("fetch failed");
  });

  it("a body that is not JSON surfaces as the status, not a parse error", async () => {
    const f = fetchAnswering(502, "<html>Bad Gateway</html>");
    const api = new WorkerApi("https://markbase.so", KEY, { fetch: f.fetch });
    const err = (await api.getTicket("t1").catch((e: unknown) => e)) as WorkerApiError;
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/502/);
    expect(err.message).not.toMatch(/Unexpected token/);
  });

  it("answers null where 'not there' is an answer: a job, a ticket, a project", async () => {
    const f = fetchAnswering(404, { error: "Job not found" });
    const api = new WorkerApi("https://markbase.so", KEY, { fetch: f.fetch });
    expect(await api.getJob("j1")).toBeNull();
    expect(await api.getTicket("t1")).toBeNull();
    expect(await api.getProject("p")).toBeNull();
    // …but a 404 on a write is still an error.
    await expect(api.finishJob("j1", "done")).rejects.toBeInstanceOf(WorkerApiError);
  });

  it("a request another worker already took (409) is nobody's problem here", async () => {
    const f = fetchAnswering(409, { error: "already claimed" });
    const api = new WorkerApi("https://markbase.so", KEY, { fetch: f.fetch });
    expect(await api.claimAgentRequest("spawn", "r1")).toBeNull();
    expect(f.calls[0].url).toBe("https://markbase.so/api/v1/worker/agent-requests/r1/claim");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ kind: "spawn" });
  });

  it("encodes path parameters", async () => {
    const f = fetchAnswering(200, { project: { slug: "a b" } });
    const api = new WorkerApi("https://markbase.so", KEY, { fetch: f.fetch });
    await api.getProject("a b");
    expect(f.calls[0].url).toBe("https://markbase.so/api/v1/projects/a%20b");
  });

  it("reports progress onto a ticket with PATCH and posts the reply as the assistant", async () => {
    const f = fetchAnswering(200, { ok: true });
    const api = new WorkerApi("https://markbase.so", KEY, { fetch: f.fetch });
    await api.patchTicket("t1", { cc_state: "running", cc_summary: null });
    await api.addTicketMessage("t1", "done");
    expect(f.calls[0].init.method).toBe("PATCH");
    expect(f.calls[0].url).toBe("https://markbase.so/api/v1/tickets/t1");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ cc_state: "running", cc_summary: null });
    expect(f.calls[1].url).toBe("https://markbase.so/api/v1/tickets/t1/messages");
    expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ role: "assistant", content: "done" });
  });
});
