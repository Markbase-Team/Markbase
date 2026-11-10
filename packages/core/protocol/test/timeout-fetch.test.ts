import { describe, it, expect, afterEach } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchWithTimeout } from "../src/timeout-fetch";

// A server that accepts the connection and never answers must not hang the caller
// forever — that is what froze the sync loop instead of letting it back off.

let server: Server | undefined;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const s = createServer(handler);
  server = s;
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}/`;
}

describe("fetchWithTimeout", () => {
  it("gives up on a server that never answers", async () => {
    const url = await serve(() => {});
    const started = Date.now();
    await expect(fetchWithTimeout(url, { timeoutMs: 200 })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("returns an answer that arrives in time", async () => {
    const url = await serve((_req, res) => res.end("ok"));
    const res = await fetchWithTimeout(url, { timeoutMs: 2_000 });
    expect(await res.text()).toBe("ok");
  });

  it("still honours the caller's own abort signal", async () => {
    const url = await serve(() => {});
    const ctrl = new AbortController();
    const pending = fetchWithTimeout(url, { timeoutMs: 10_000, signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toThrow();
  });
});
