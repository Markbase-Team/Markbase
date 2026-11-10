import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A throwaway home, so the worker lock these tests plant never touches the
// real ~/.markbaseConfig. Set before the lock module reads it.
process.env.MARKBASE_HOME = mkdtempSync(join(tmpdir(), "mb-runner-"));
const { locksDir } = await import("@markbase/vault/markbase-home");
const { runTicketWorker } = await import("../src/run-ticket-worker");

const LOCK = join(locksDir(), "ticket-worker.json");

function plantLiveHolder(owner: string): void {
  mkdirSync(locksDir(), { recursive: true });
  // pid 1 always exists, so this holder reads as alive and ticking.
  writeFileSync(LOCK, JSON.stringify({ owner, pid: 1, heartbeat: Date.now(), since: Date.now() }));
}

/** A stand-in web app that answers /api/v1/me however the test says. */
async function app(onMe: () => { status: number; body: string }): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const { status, body } = onMe();
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return { url: `http://127.0.0.1:${addr.port}`, server };
}

afterEach(() => rmSync(LOCK, { force: true }));

describe("runTicketWorker: a worker a host can stop", () => {
  it("returns at once when told to stop before it starts, touching nothing", async () => {
    const ac = new AbortController();
    ac.abort();
    const lines: string[] = [];
    // appUrl points nowhere: a worker that got as far as asking who it is
    // would fail loudly here, which is the point.
    await runTicketWorker({
      appUrl: "http://127.0.0.1:9",
      apiKey: "jsk_test",
      signal: ac.signal,
      lockOwner: "desktop app",
      log: (m) => lines.push(m),
    });
    expect(lines).toEqual([]);
  });

  it("waits while another process on this machine runs tickets, and says so once", async () => {
    plantLiveHolder("cli");
    const ac = new AbortController();
    const lines: string[] = [];
    const states: string[] = [];
    const run = runTicketWorker({
      appUrl: "http://127.0.0.1:9",
      apiKey: "jsk_test",
      signal: ac.signal,
      lockOwner: "desktop app",
      log: (m) => lines.push(m),
      onState: (s) => states.push(s.kind === "waiting" ? `waiting:${s.holder.owner}` : s.kind),
    });
    // Nothing settles while the other process holds the lock…
    const early = await Promise.race([run.then(() => "returned"), new Promise((r) => setTimeout(() => r("waiting"), 50))]);
    expect(early).toBe("waiting");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/another Markbase process is running tickets .* the cli \(pid 1\)/);
    expect(states).toEqual(["waiting:cli"]);
    // …and the holder's lock is untouched by our waiting.
    expect(JSON.parse(readFileSync(LOCK, "utf8")).owner).toBe("cli");
    // Stop is honoured mid-wait.
    ac.abort();
    await run;
    expect(JSON.parse(readFileSync(LOCK, "utf8")).owner).toBe("cli");
  });

  it("holds the lock while it runs, and lets go when it stops", async () => {
    let heldDuringRun: string | null = null;
    const { url, server } = await app(() => {
      // The worker asks who it is only once it holds the lock.
      try {
        heldDuringRun = JSON.parse(readFileSync(LOCK, "utf8")).owner;
      } catch {
        heldDuringRun = null;
      }
      return { status: 401, body: JSON.stringify({ error: "bad key" }) };
    });
    try {
      await expect(
        runTicketWorker({ appUrl: url, apiKey: "jsk_test", lockOwner: "desktop app", log: () => {} })
      ).rejects.toThrow(/Failed to resolve worker owner: 401/);
      expect(heldDuringRun).toBe("desktop app");
      // Released on the way out, so the next worker is not refused by a ghost.
      expect(() => readFileSync(LOCK)).toThrow();
    } finally {
      server.close();
    }
  });
});
