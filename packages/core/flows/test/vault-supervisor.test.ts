import { describe, it, expect, vi } from "vitest";
import {
  startVaultSupervisor,
  type SupervisorDeps,
} from "../src/vault-supervisor";
import type { MountedVault } from "@markbase/vault/vault-registry";

// Mounting declares a fact; the supervisor makes it true.
//
// Today each host does its own bookkeeping. The desktop keeps a Map of stop
// handles and calls them itself, so its unmount can stop a daemon — but only
// because the daemon lives in the same process. The CLI starts daemons once at
// launch and never looks at the registry again, so `markbase vault mount` and
// `vault unmount` are advisory: nothing happens until the service restarts.
//
// So: one loop, in both hosts. It reads the declared mounts, compares them with
// what is actually running, and closes the gap. Mount and unmount go back to
// being edits to a file.
//
// The third case matters as much as the other two and exists in neither host
// today: a vault whose lock is held by the other host. Starting it throws, the
// host gives up, and it never tries again — so quitting the desktop app leaves
// the CLI daemon permanently not syncing vaults it could now have.

function vault(id: string, dir = `/${id}`): MountedVault {
  return { vaultId: id, name: id, dir };
}

/** A fake sync engine: records what was started and stopped. */
function engine(opts: { lockedIds?: string[] } = {}) {
  const started: string[] = [];
  const stopped: string[] = [];
  const locked = new Set(opts.lockedIds ?? []);
  return {
    started,
    stopped,
    release(id: string) {
      locked.delete(id);
    },
    start: vi.fn(async (v: MountedVault) => {
      if (locked.has(v.vaultId)) {
        const e = new Error(`the desktop app has ${v.vaultId}`);
        e.name = "VaultLockedError";
        throw e;
      }
      started.push(v.vaultId);
      return async () => {
        stopped.push(v.vaultId);
      };
    }),
  };
}

function deps(over: Partial<SupervisorDeps> = {}): SupervisorDeps {
  return {
    readMounted: () => [],
    startSync: async () => async () => {},
    log: () => {},
    retryMs: 10,
    ...over,
  };
}

describe("the vault supervisor", () => {
  it("starts a daemon for every vault that is declared", async () => {
    const e = engine();
    const sup = startVaultSupervisor(
      deps({ readMounted: () => [vault("a"), vault("b")], startSync: e.start })
    );
    await sup.settled();
    expect(e.started.sort()).toEqual(["a", "b"]);
    await sup.stop();
  });

  it("starts the one that appears, and leaves the running ones alone", async () => {
    const e = engine();
    let mounted = [vault("a")];
    const sup = startVaultSupervisor(
      deps({ readMounted: () => mounted, startSync: e.start })
    );
    await sup.settled();

    mounted = [vault("a"), vault("b")];
    await sup.reconcile();

    expect(e.started).toEqual(["a", "b"]);
    expect(e.stopped).toEqual([]); // 'a' was never restarted
    await sup.stop();
  });

  it("stops the daemon for a vault that is no longer declared", async () => {
    const e = engine();
    let mounted = [vault("a"), vault("b")];
    const sup = startVaultSupervisor(
      deps({ readMounted: () => mounted, startSync: e.start })
    );
    await sup.settled();

    // This is unmount, from either host: the entry goes, and the daemon with it.
    mounted = [vault("a")];
    await sup.reconcile();

    expect(e.stopped).toEqual(["b"]);
    await sup.stop();
  });

  it("restarts a vault whose folder moved, rather than syncing the old one", async () => {
    const e = engine();
    let mounted = [vault("a", "/old")];
    const sup = startVaultSupervisor(
      deps({ readMounted: () => mounted, startSync: e.start })
    );
    await sup.settled();

    mounted = [vault("a", "/new")];
    await sup.reconcile();

    expect(e.stopped).toEqual(["a"]);
    expect(e.started).toEqual(["a", "a"]);
    await sup.stop();
  });

  it("keeps trying a vault the other host has, and takes it when released", async () => {
    const e = engine({ lockedIds: ["a"] });
    const sup = startVaultSupervisor(
      deps({ readMounted: () => [vault("a")], startSync: e.start })
    );
    await sup.settled();
    expect(e.started).toEqual([]); // locked: nothing running here

    // The desktop app quits. Nothing tells us — we find out by trying again.
    e.release("a");
    await sup.reconcile();
    expect(e.started).toEqual(["a"]);
    await sup.stop();
  });

  it("says a vault is held by someone else once, not on every pass", async () => {
    const lines: string[] = [];
    const e = engine({ lockedIds: ["a"] });
    const sup = startVaultSupervisor(
      deps({
        readMounted: () => [vault("a")],
        startSync: e.start,
        log: (m) => lines.push(m),
      })
    );
    await sup.settled();
    await sup.reconcile();
    await sup.reconcile();

    // A daemon reconciling every few seconds would otherwise fill the log with
    // the same sentence forever. Three passes, one line.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("a");
    await sup.stop();
  });

  it("reports a vault that keeps failing once, not on every pass", async () => {
    const lines: string[] = [];
    const failing = vi.fn(async () => {
      throw new Error("disk is full");
    });
    const sup = startVaultSupervisor(
      deps({
        readMounted: () => [vault("a")],
        startSync: failing,
        log: (m) => lines.push(m),
      })
    );
    await sup.settled();
    await sup.reconcile();
    await sup.reconcile();

    // Same rule as a locked vault, for the same reason: a host reconciling every
    // few seconds turns one persistent problem — no API key, a folder that isn't
    // there — into a log nobody can read. Keep trying; say it once.
    expect(failing).toHaveBeenCalledTimes(3);
    expect(lines).toHaveLength(1);
    await sup.stop();
  });

  it("says so again when a vault that was fine starts failing", async () => {
    const lines: string[] = [];
    let mounted = [vault("a", "/old")];
    let healthy = true;
    const sup = startVaultSupervisor(
      deps({
        readMounted: () => mounted,
        startSync: async () => {
          if (!healthy) throw new Error("disk is full");
          return async () => {};
        },
        log: (m) => lines.push(m),
      })
    );
    await sup.settled();
    expect(lines).toHaveLength(0); // started cleanly: nothing to report

    // The folder moved, so it is stopped and started again — and this time where
    // it landed is unusable. Silence here would be the opposite failure: a vault
    // that quietly stopped syncing and never said why.
    healthy = false;
    mounted = [vault("a", "/new")];
    await sup.reconcile();
    expect(lines).toHaveLength(1);

    // Still failing on the next pass: still one line.
    await sup.reconcile();
    expect(lines).toHaveLength(1);
    await sup.stop();
  });

  it("carries on when one vault fails to start", async () => {
    const e = engine();
    const failing = vi.fn(async (v: MountedVault) => {
      if (v.vaultId === "bad") throw new Error("disk is full");
      return e.start(v);
    });
    const sup = startVaultSupervisor(
      deps({
        readMounted: () => [vault("bad"), vault("good")],
        startSync: failing,
      })
    );
    await sup.settled();
    expect(e.started).toEqual(["good"]);
    await sup.stop();
  });

  it("stops every daemon when the host shuts down", async () => {
    const e = engine();
    const sup = startVaultSupervisor(
      deps({ readMounted: () => [vault("a"), vault("b")], startSync: e.start })
    );
    await sup.settled();
    await sup.stop();
    expect(e.stopped.sort()).toEqual(["a", "b"]);
  });

  it("can say what it is running, so a host can decide whether to wait on quit", async () => {
    const e = engine({ lockedIds: ["b"] });
    const sup = startVaultSupervisor(
      deps({ readMounted: () => [vault("a"), vault("b")], startSync: e.start })
    );
    await sup.settled();

    // 'b' is declared but held elsewhere — it is desired, not running, and the
    // quit handler must not block the app waiting for a daemon that isn't there.
    expect(sup.running()).toEqual(["a"]);

    await sup.stop();
    expect(sup.running()).toEqual([]);
  });

  it("does nothing on a pass where nothing changed", async () => {
    const e = engine();
    const sup = startVaultSupervisor(
      deps({ readMounted: () => [vault("a")], startSync: e.start })
    );
    await sup.settled();
    await sup.reconcile();
    await sup.reconcile();
    expect(e.start).toHaveBeenCalledTimes(1);
    expect(e.stopped).toEqual([]);
    await sup.stop();
  });
});
