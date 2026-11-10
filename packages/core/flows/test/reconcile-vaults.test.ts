import { describe, it, expect, vi } from "vitest";
import {
  reclaimVaults,
  repointVault,
  type ReconcileDeps,
} from "../src/reconcile-vaults";
import { unattendedOperator, type Operator } from "../src/operator";
import { fakeRegistry } from "./fake-registry";

// Two flows for the same disagreement: the disk says a vault lives here, and
// the registry says otherwise. The folder carries a marker naming its vault, so
// when the two disagree the folder is usually right — a reset registry, a
// reinstall, a config copied from another machine.
//
// They differ in one deliberate way, and it is worth keeping.
//
//   reclaim  — a vault folder sitting in the default home that the registry
//              forgot. Reconnected WITHOUT asking: offering to mount a vault
//              whose files are already on disk invites answering with a
//              different folder, which leaves one vault with two homes.
//
//   repoint  — a vault's marker found somewhere unexpected, usually nested
//              inside another vault. ASKS, because following it is a choice:
//              the folder may have been dragged there by accident.
//
// Both exist only in the desktop app today. The CLI has neither, so a daemon on
// a server cannot recover from a forgotten registry at all.
//
// Both write through a mutator now rather than handing back a whole list. These
// run inside a daemon that reconciles every few seconds, against a registry the
// other client is writing to as well, so "read the list, write it back changed"
// is not a safe shape here — it drops whatever landed in between.

function fakeOperator(answers: { approve?: boolean } = {}) {
  const asked = {
    approvals: [] as { action: string; detail?: string }[],
    events: [] as string[],
  };
  const op: Operator = {
    approve: vi.fn(async (r) => {
      asked.approvals.push({ action: r.action, detail: r.detail });
      return answers.approve ?? false;
    }),
    chooseOption: vi.fn(async () => null),
    chooseFolder: vi.fn(async () => null),
    reportEvent: vi.fn((e) => asked.events.push(e.message)),
    reportProgress: vi.fn(),
  };
  return { op, asked };
}

function deps(over: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    operator: fakeOperator().op,
    readMounted: () => [],
    readUnmounted: () => [],
    updateMounted: vi.fn(async (next) => next([])),
    markerOf: () => null,
    listCloudVaults: async () => [{ id: "v1", name: "Blog" }],
    startSync: vi.fn(),
    listSubdirs: () => [],
    defaultHome: "/Users/test/Markbase",
    ...over,
  };
}

describe("reclaimVaults", () => {
  it("reconnects a forgotten vault folder without asking anyone", async () => {
    const { op, asked } = fakeOperator();
    const reg = fakeRegistry();
    const d = deps({
      operator: op,
      readMounted: reg.read,
      updateMounted: reg.update,
      listSubdirs: () => ["/Users/test/Markbase/Blog"],
      markerOf: (dir) => (dir === "/Users/test/Markbase/Blog" ? "v1" : null),
    });
    const n = await reclaimVaults(d);
    expect(n).toBe(1);
    expect(op.approve).not.toHaveBeenCalled();
    expect(reg.list).toEqual([
      { vaultId: "v1", name: "Blog", dir: "/Users/test/Markbase/Blog" },
    ]);
    expect(d.startSync).toHaveBeenCalledTimes(1);
    // Silent to the operator is not silent to the log: something changed on
    // disk and the person should be able to find out why.
    expect(asked.events.join(" ")).toContain("Blog");
  });

  it("leaves a vault the registry already knows about alone", async () => {
    const d = deps({
      readMounted: () => [{ vaultId: "v1", name: "Blog", dir: "/elsewhere" }],
      listSubdirs: () => ["/Users/test/Markbase/Blog"],
      markerOf: () => "v1",
    });
    expect(await reclaimVaults(d)).toBe(0);
    expect(d.updateMounted).not.toHaveBeenCalled();
  });

  it("leaves a vault alone once it has been deliberately unmounted", async () => {
    // The point of the whole tombstone. The folder is still sitting in the
    // default home — unmounting does not delete anyone's files — so without
    // this, reclaim sees a vault the registry has "forgotten" and puts it
    // straight back. The user unmounts it; seconds later it is mounted again.
    const { op, asked } = fakeOperator();
    const d = deps({
      operator: op,
      readUnmounted: () => ["v1"],
      listSubdirs: () => ["/Users/test/Markbase/Blog"],
      markerOf: () => "v1",
    });

    expect(await reclaimVaults(d)).toBe(0);
    expect(d.updateMounted).not.toHaveBeenCalled();
    expect(d.startSync).not.toHaveBeenCalled();

    // Silently: this runs every few seconds on both hosts, so announcing the
    // same decision each pass would bury the log — the same mistake the
    // supervisor's reportOnce exists to avoid.
    expect(asked.events).toEqual([]);
  });

  it("does not reclaim a folder that another account mounted", async () => {
    // Its marker says who mounted it. The vault would not be in this account's
    // cloud list either, but a folder that says it is someone else's is left
    // alone before the cloud is even consulted about it.
    const reg = fakeRegistry();
    const d = deps({
      readMounted: reg.read,
      updateMounted: reg.update,
      listSubdirs: () => ["/Users/test/Markbase/Blog"],
      markerOf: () => "v1",
      markerOwnerOf: () => "owner-2",
      keyOwner: () => "owner-1",
    });
    expect(await reclaimVaults(d)).toBe(0);
    expect(reg.list).toEqual([]);
    expect(d.startSync).not.toHaveBeenCalled();
  });

  it("records the account on a vault it reconnects", async () => {
    const reg = fakeRegistry();
    const d = deps({
      readMounted: reg.read,
      updateMounted: reg.update,
      listSubdirs: () => ["/Users/test/Markbase/Blog"],
      markerOf: () => "v1",
      // A folder from before owners were recorded: the cloud list vouches.
      markerOwnerOf: () => null,
      keyOwner: () => "owner-1",
    });
    expect(await reclaimVaults(d)).toBe(1);
    expect(reg.list[0].ownerId).toBe("owner-1");
  });

  it("still reclaims the vaults that were not unmounted", async () => {
    const reg = fakeRegistry();
    const d = deps({
      readMounted: reg.read,
      updateMounted: reg.update,
      readUnmounted: () => ["v1"],
      listCloudVaults: async () => [
        { id: "v1", name: "Blog" },
        { id: "v2", name: "Stocks" },
      ],
      listSubdirs: () => ["/Users/test/Markbase/Blog", "/Users/test/Markbase/Stocks"],
      markerOf: (dir) => (dir.endsWith("Blog") ? "v1" : "v2"),
    });

    // One tombstoned vault must not stop the pass for the others.
    expect(await reclaimVaults(d)).toBe(1);
    expect(reg.list.map((m) => m.vaultId)).toEqual(["v2"]);
  });

  it("ignores a folder whose vault this account does not own", async () => {
    // A shared machine: someone else's vault folder names a vault we cannot
    // read. Mounting it would fail on every sync instead of obviously here.
    const d = deps({
      listSubdirs: () => ["/Users/test/Markbase/Theirs"],
      markerOf: () => "someone-elses-vault",
    });
    expect(await reclaimVaults(d)).toBe(0);
    expect(d.updateMounted).not.toHaveBeenCalled();
  });

  it("does nothing when the vault list cannot be trusted", async () => {
    // null is "I don't know", not "you have none". Treating them the same is
    // how a vault gets reconnected to the wrong account.
    const d = deps({
      listCloudVaults: async () => null,
      listSubdirs: () => ["/Users/test/Markbase/Blog"],
      markerOf: () => "v1",
    });
    expect(await reclaimVaults(d)).toBe(0);
    expect(d.updateMounted).not.toHaveBeenCalled();
  });

  it("skips folders with no marker, and counts several reclaims", async () => {
    const reg = fakeRegistry();
    const d = deps({
      readMounted: reg.read,
      updateMounted: reg.update,
      listCloudVaults: async () => [
        { id: "v1", name: "Blog" },
        { id: "v2", name: "Stocks" },
      ],
      listSubdirs: () => [
        "/Users/test/Markbase/Blog",
        "/Users/test/Markbase/random",
        "/Users/test/Markbase/Stocks",
      ],
      markerOf: (dir) =>
        dir.endsWith("Blog") ? "v1" : dir.endsWith("Stocks") ? "v2" : null,
    });
    expect(await reclaimVaults(d)).toBe(2);
    expect(d.startSync).toHaveBeenCalledTimes(2);
    expect(reg.list.map((v) => v.vaultId).sort()).toEqual(["v1", "v2"]);
  });

  it("does not reconnect a vault twice when the other client got there first", async () => {
    // Both clients reconcile on a timer, so they scan the same folder at close
    // to the same moment. Whoever writes second must notice and stand down
    // rather than append a duplicate entry for the same vault.
    const reg = fakeRegistry();
    const d = deps({
      // Empty when this flow looks; the other client writes before we do.
      readMounted: () => [],
      updateMounted: vi.fn(async (next) => {
        reg.concurrentlyAdd({
          vaultId: "v1",
          name: "Blog",
          dir: "/Users/test/Markbase/Blog",
        });
        return reg.update(next);
      }),
      listSubdirs: () => ["/Users/test/Markbase/Blog"],
      markerOf: () => "v1",
    });

    expect(await reclaimVaults(d)).toBe(0); // nothing for us to do after all
    expect(reg.list).toHaveLength(1);
    expect(d.startSync).not.toHaveBeenCalled();
  });

  it("reclaims on a headless machine too, since it asks nothing", async () => {
    const d = deps({
      operator: unattendedOperator({ log: () => {} }),
      listSubdirs: () => ["/Users/test/Markbase/Blog"],
      markerOf: () => "v1",
    });
    expect(await reclaimVaults(d)).toBe(1);
  });
});

describe("repointVault", () => {
  const found = { vaultId: "v1", dir: "/Users/test/ns/Blog" };

  it("says nothing when the registry already points where the vault is", async () => {
    const { op } = fakeOperator();
    const d = deps({
      operator: op,
      readMounted: () => [{ vaultId: "v1", name: "Blog", dir: found.dir }],
    });
    expect(await repointVault(found, "NeuroSpark", d)).toBe(false);
    expect(op.approve).not.toHaveBeenCalled();
  });

  it("asks, naming the vault and where it turned up", async () => {
    const { op, asked } = fakeOperator({ approve: true });
    const d = deps({
      operator: op,
      readMounted: () => [{ vaultId: "v1", name: "Blog", dir: "/old/place" }],
    });
    await repointVault(found, "NeuroSpark", d);
    expect(asked.approvals[0].action).toContain("Blog");
    expect(asked.approvals[0].detail).toContain(found.dir);
    expect(asked.approvals[0].detail).toContain("NeuroSpark");
  });

  it("moves the registry entry and starts syncing when accepted", async () => {
    const { op } = fakeOperator({ approve: true });
    const other = { vaultId: "v9", name: "Other", dir: "/other" };
    const reg = fakeRegistry([other, { vaultId: "v1", name: "Blog", dir: "/old/place" }]);
    const d = deps({ operator: op, readMounted: reg.read, updateMounted: reg.update });

    expect(await repointVault(found, "NeuroSpark", d)).toBe(true);
    expect(reg.list).toEqual([other, { vaultId: "v1", name: "Blog", dir: found.dir }]);
    expect(d.startSync).toHaveBeenCalledWith({
      vaultId: "v1",
      name: "Blog",
      dir: found.dir,
    });
  });

  it("keeps a vault mounted elsewhere while the question was being answered", async () => {
    // Repointing asks, and the answer can take as long as someone takes to read
    // it. Anything mounted in that window has to survive the move.
    const { op } = fakeOperator({ approve: true });
    const late = { vaultId: "late", name: "Stocks", dir: "/Users/test/stocks" };
    const reg = fakeRegistry([{ vaultId: "v1", name: "Blog", dir: "/old/place" }]);
    const d = deps({
      operator: {
        ...op,
        approve: vi.fn(async () => {
          reg.concurrentlyAdd(late);
          return true;
        }),
      },
      readMounted: reg.read,
      updateMounted: reg.update,
    });

    expect(await repointVault(found, "NeuroSpark", d)).toBe(true);
    expect(reg.list.map((v) => v.vaultId).sort()).toEqual(["late", "v1"]);
    expect(reg.list.find((v) => v.vaultId === "v1")?.dir).toBe(found.dir);
  });

  it("changes nothing when declined", async () => {
    const { op } = fakeOperator({ approve: false });
    const d = deps({
      operator: op,
      readMounted: () => [{ vaultId: "v1", name: "Blog", dir: "/old/place" }],
    });
    expect(await repointVault(found, "NeuroSpark", d)).toBe(false);
    expect(d.updateMounted).not.toHaveBeenCalled();
    expect(d.startSync).not.toHaveBeenCalled();
  });

  it("names a vault the registry has never heard of from the cloud list", async () => {
    const { op, asked } = fakeOperator({ approve: true });
    const d = deps({ operator: op, readMounted: () => [] });
    expect(await repointVault(found, "NeuroSpark", d)).toBe(true);
    expect(asked.approvals[0].action).toContain("Blog");
  });

  it("stays quiet about a vault that is not ours at all", async () => {
    const { op } = fakeOperator();
    const d = deps({
      operator: op,
      readMounted: () => [],
      listCloudVaults: async () => [{ id: "v2", name: "Someone else's" }],
    });
    expect(await repointVault(found, "NeuroSpark", d)).toBe(false);
    expect(op.approve).not.toHaveBeenCalled();
  });

  it("on a headless machine, declines by policy rather than hanging", async () => {
    const d = deps({
      operator: unattendedOperator({ log: () => {} }),
      readMounted: () => [{ vaultId: "v1", name: "Blog", dir: "/old/place" }],
    });
    expect(await repointVault(found, "NeuroSpark", d)).toBe(false);
    expect(d.updateMounted).not.toHaveBeenCalled();
  });
});
