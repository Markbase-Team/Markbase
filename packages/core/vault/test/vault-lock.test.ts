import { describe, it, expect, afterEach } from "vitest";
import { baseStoreDir, locksDir } from "../src/markbase-home";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { acquireVaultLock, acquireWorkerLock, VaultLockedError } from "../src/vault-lock";

// A throwaway home. These tests write real lock files and sync bases, and doing
// that in the user's own ~/.markbaseConfig once created the directory early
// enough to break the migration that moves into it.
process.env.MARKBASE_HOME = mkdtempSync(join(tmpdir(), "mb-home-"));

// The lock lives beside the config, keyed by vault id.
const ID = "test-vault-lock-0000";
const PATH = join(locksDir(), `${ID}.json`);

function plant(info: Record<string, unknown>): void {
  mkdirSync(locksDir(), { recursive: true });
  writeFileSync(PATH, JSON.stringify(info));
}

afterEach(() => rmSync(PATH, { force: true }));

describe("vault lock: one syncing process per vault per machine", () => {
  it("lets an unheld vault be claimed, and released", () => {
    const lock = acquireVaultLock(ID, "cli");
    expect(lock).toBeTruthy();
    lock.release();
    // Released, so the next process gets it.
    const again = acquireVaultLock(ID, "desktop app");
    expect(again).toBeTruthy();
    again.release();
  });

  it("refuses when a live process on this machine holds it", () => {
    // A holder that exists (this very process) and is ticking.
    plant({ owner: "cli", pid: process.pid + 0, heartbeat: Date.now(), since: Date.now() });
    // Same pid means "us", which is allowed — use a different, definitely-live one.
    plant({ owner: "cli", pid: 1, heartbeat: Date.now(), since: Date.now() }); // pid 1 always exists
    expect(() => acquireVaultLock(ID, "desktop app")).toThrow(VaultLockedError);
    try {
      acquireVaultLock(ID, "desktop app");
    } catch (e) {
      // The message has to name who to go and stop.
      expect((e as VaultLockedError).message).toContain("cli");
    }
  });

  it("takes over a lock whose holder stopped refreshing", () => {
    // Alive, but silent for well over the stale window — a hung or killed daemon
    // must not lock a vault out forever.
    plant({ owner: "cli", pid: 1, heartbeat: Date.now() - 10 * 60_000, since: Date.now() });
    const lock = acquireVaultLock(ID, "desktop app");
    expect(lock).toBeTruthy();
    lock.release();
  });

  it("takes over a lock whose holder no longer exists", () => {
    // A pid that cannot be running (the kernel would never assign it).
    plant({ owner: "cli", pid: 2_147_483_600, heartbeat: Date.now(), since: Date.now() });
    const lock = acquireVaultLock(ID, "desktop app");
    expect(lock).toBeTruthy();
    lock.release();
  });
});

describe("how long we have held it", () => {
  it("keeps `since` fixed across heartbeats", () => {
    const lock = acquireVaultLock(ID, "cli");
    const since = JSON.parse(readFileSync(PATH, "utf8")).since;

    lock.heartbeat();
    const after = JSON.parse(readFileSync(PATH, "utf8"));

    expect(after.since).toBe(since); // when we took it — not when we last said so
    expect(after.heartbeat).toBeGreaterThanOrEqual(since);
    lock.release();
  });
});

describe("losing the vault while running", () => {
  // The lock used to be read once at startup and only written thereafter, so the
  // process that LOST a takeover was never told and kept syncing — two daemons on
  // one folder, which is the entire thing the lock exists to prevent.

  it("tells the holder, and stops beating, when another live process takes over", () => {
    const taken: string[] = [];
    const lock = acquireVaultLock(ID, "cli", (holder) => taken.push(holder.owner));

    expect(lock.heartbeat()).toBe(true); // still ours

    // The desktop app takes it: alive (pid 1 always is) and ticking.
    plant({ owner: "desktop app", pid: 1, heartbeat: Date.now(), since: Date.now() });

    expect(lock.heartbeat()).toBe(false);
    expect(taken).toEqual(["desktop app"]);

    // Inert afterwards, and it reports loss exactly once — a caller that stops on
    // the first `false` must not be stopped again by the next heartbeat.
    expect(lock.heartbeat()).toBe(false);
    expect(taken).toEqual(["desktop app"]);
  });

  it("does not overwrite the new holder's record after losing it", () => {
    const lock = acquireVaultLock(ID, "cli");
    plant({ owner: "desktop app", pid: 1, heartbeat: Date.now(), since: Date.now() });
    lock.heartbeat();

    // The file still names the winner; the loser must not stamp itself back in.
    expect(JSON.parse(readFileSync(PATH, "utf8")).owner).toBe("desktop app");

    // And releasing must not delete a lock that is now somebody else's.
    lock.release();
    expect(existsSync(PATH)).toBe(true);
    expect(JSON.parse(readFileSync(PATH, "utf8")).owner).toBe("desktop app");
  });

  it("keeps the vault when the record names a process that died", () => {
    const lock = acquireVaultLock(ID, "cli", () => {
      throw new Error("must not be reported as lost");
    });
    // A peer took the lock and then crashed. That is an abandoned record, not a
    // live rival — retiring a healthy daemon over it would leave nobody syncing.
    plant({ owner: "desktop app", pid: 2_147_483_600, heartbeat: Date.now(), since: Date.now() });

    expect(lock.heartbeat()).toBe(true);
    // Retaken: the file is ours again.
    expect(JSON.parse(readFileSync(PATH, "utf8")).pid).toBe(process.pid);
    lock.release();
  });

  it("keeps the vault when the lock file is deleted underneath it", () => {
    const lock = acquireVaultLock(ID, "cli", () => {
      throw new Error("must not be reported as lost");
    });
    rmSync(PATH, { force: true });

    expect(lock.heartbeat()).toBe(true);
    expect(existsSync(PATH)).toBe(true); // written back
    lock.release();
  });

  it("reports loss to a holder that stopped ticking, once someone else takes over", () => {
    const taken: string[] = [];
    const lock = acquireVaultLock(ID, "cli", (h) => taken.push(h.owner));
    // We hung: our own heartbeat went stale, and the desktop app took the vault.
    plant({ owner: "desktop app", pid: 1, heartbeat: Date.now(), since: Date.now() });
    expect(lock.heartbeat()).toBe(false);
    expect(taken).toEqual(["desktop app"]);
  });
});

// The ticket worker holds the same kind of lock, under a fixed name: one
// process on this machine runs the owner's tickets, and the other host waits.
describe("worker lock: one ticket worker per machine", () => {
  const WORKER_PATH = join(locksDir(), "ticket-worker.json");
  afterEach(() => rmSync(WORKER_PATH, { force: true }));

  it("is held under its own file, beside the vault locks", () => {
    const lock = acquireWorkerLock("desktop app");
    expect(existsSync(WORKER_PATH)).toBe(true);
    expect(JSON.parse(readFileSync(WORKER_PATH, "utf8")).owner).toBe("desktop app");
    lock.release();
    expect(existsSync(WORKER_PATH)).toBe(false);
  });

  it("refuses a second worker while the first is alive, and names it", () => {
    mkdirSync(locksDir(), { recursive: true });
    writeFileSync(
      WORKER_PATH,
      JSON.stringify({ owner: "cli", pid: 1, heartbeat: Date.now(), since: Date.now() })
    );
    expect(() => acquireWorkerLock("desktop app")).toThrow(VaultLockedError);
    expect(() => acquireWorkerLock("desktop app")).toThrow(/tickets are already being run by the cli/);
  });

  it("takes over from a holder that stopped ticking", () => {
    mkdirSync(locksDir(), { recursive: true });
    writeFileSync(
      WORKER_PATH,
      JSON.stringify({ owner: "cli", pid: 1, heartbeat: Date.now() - 10 * 60_000, since: 0 })
    );
    const lock = acquireWorkerLock("desktop app");
    expect(JSON.parse(readFileSync(WORKER_PATH, "utf8")).owner).toBe("desktop app");
    lock.release();
  });

  it("does not collide with a vault lock", () => {
    const vault = acquireVaultLock(ID, "cli");
    const worker = acquireWorkerLock("desktop app");
    expect(JSON.parse(readFileSync(PATH, "utf8")).owner).toBe("cli");
    expect(JSON.parse(readFileSync(WORKER_PATH, "utf8")).owner).toBe("desktop app");
    worker.release();
    vault.release();
  });
});
