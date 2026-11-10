import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addMountedVault,
  adoptLegacyVaults,
  readMountedVaults,
  readSavedInstance,
  readUnmountedVaults,
  removeMountedVault,
  saveInstance,
  unmountVault,
  updateMountedVaults,
  type MountedVault,
} from "../src/vault-registry";

// The registry is the one file every Markbase process on a machine reads and
// writes: which vaults are mounted, and where. The desktop app writes it from
// its main process, the CLI from `vault mount`, and — once a supervisor
// reconciles what is running against what is declared — both of them on every
// pass.
//
// Every mutation was read-modify-write through writeMountedVaults, so two
// writers overlapping lost one of the edits: mount a vault in the CLI while the
// desktop mounts another, and one of them simply is not there afterwards. Rare
// while only the desktop wrote often; routine the moment a supervisor does.
//
// MARKBASE_HOME points the whole module at a temporary directory. That works
// only because the path is resolved per call now — it used to be a const read
// at import, so every test in a run shared whichever directory the first import
// happened to see, and the real ~/.markbaseConfig was one bad env var away.

let dir: string;
let registry: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "markbase-registry-"));
  registry = join(dir, "config.json");
  process.env.MARKBASE_HOME = dir;
});

afterEach(() => {
  delete process.env.MARKBASE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

const v = (id: string, dirPath = `/${id}`): MountedVault => ({
  vaultId: id,
  name: id,
  dir: dirPath,
});

describe("the registry as a shared file", () => {
  it("keeps fields it does not own", async () => {
    writeFileSync(
      registry,
      JSON.stringify({ apiKey: "jsk_keep_me", mirrorDir: "/mirror" }) + "\n"
    );
    await addMountedVault(v("v1"));

    const after = JSON.parse(readFileSync(registry, "utf8"));
    expect(after.apiKey).toBe("jsk_keep_me");
    expect(after.mirrorDir).toBe("/mirror");
    expect(after.vaults).toHaveLength(1);
  });

  it("re-mounting a vault moves it rather than listing it twice", async () => {
    await addMountedVault(v("v1", "/old"));
    await addMountedVault(v("v1", "/new"));

    const vaults = readMountedVaults();
    expect(vaults).toHaveLength(1);
    expect(vaults[0].dir).toBe("/new");
  });

  it("does not lose an entry another process added meanwhile", async () => {
    await addMountedVault(v("v1"));

    await updateMountedVaults((current) => {
      // What a second process looks like from here: it wrote while this caller
      // was deciding. The list handed to us was read inside the lock, so the
      // merge below is against the file as it is now.
      const other = JSON.parse(readFileSync(registry, "utf8"));
      other.vaults = [...other.vaults, v("v2")];
      writeFileSync(registry, JSON.stringify(other) + "\n");
      return [...current, v("v3")];
    });

    // v2 landed after our read and before our write. Losing it is the bug; the
    // lock is what stops the interleaving from happening at all.
    const ids = readMountedVaults().map((x) => x.vaultId);
    expect(ids).toContain("v1");
    expect(ids).toContain("v3");
  });

  it("serialises concurrent updates instead of interleaving them", async () => {
    const slow = (id: string) => async (current: MountedVault[]) => {
      await new Promise((r) => setTimeout(r, 10));
      return [...current, v(id)];
    };

    await Promise.all([
      updateMountedVaults(slow("a")),
      updateMountedVaults(slow("b")),
      updateMountedVaults(slow("c")),
    ]);

    const ids = readMountedVaults()
      .map((x) => x.vaultId)
      .sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("leaves the old file intact when a write fails midway", async () => {
    await addMountedVault(v("v1"));
    const before = readFileSync(registry, "utf8");

    await expect(
      updateMountedVaults(() => {
        throw new Error("something went wrong deciding");
      })
    ).rejects.toThrow("something went wrong");

    // A half-written registry is worse than a stale one: every process on the
    // machine reads this file, and an unparseable one reads as "no vaults".
    expect(readFileSync(registry, "utf8")).toBe(before);
    expect(readMountedVaults()).toHaveLength(1);
  });

  it("never leaves a temporary file or a held lock behind", async () => {
    await updateMountedVaults((current) => [...current, v("v1")]);
    expect(readdirSync(dir)).toEqual(["config.json"]);

    // Even when the caller throws.
    await expect(
      updateMountedVaults(() => {
        throw new Error("nope");
      })
    ).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["config.json"]);
  });

  it("removing a mount keeps the others", async () => {
    await addMountedVault(v("v1"));
    await addMountedVault(v("v2"));
    await removeMountedVault("v1");

    const vaults = readMountedVaults();
    expect(vaults).toHaveLength(1);
    expect(vaults[0].vaultId).toBe("v2");
  });

  it("reads an absent or unreadable registry as no vaults, not a crash", async () => {
    expect(existsSync(registry)).toBe(false);
    expect(readMountedVaults()).toEqual([]);

    writeFileSync(registry, "{ not json");
    expect(readMountedVaults()).toEqual([]);
  });
});

// Unmounting has to survive the thing that puts vaults back.
//
// reclaimVaults walks the default home and reconnects any vault folder the
// registry has forgotten, deliberately without asking — asking invites
// answering with a different folder, and then one vault has two homes. But
// "forgotten" and "deliberately removed" look identical from there, so
// unmounting a vault whose folder still sits in ~/Markbase was undone on the
// next pass. That used to mean "at the next restart"; with the supervisor
// running reclaim on both hosts it means within seconds.
//
// So a deliberate unmount leaves a tombstone: this machine was told to stop
// syncing this vault, and reclaim must not argue. It is NOT a blanket record of
// every removal — see the trash case below.
describe("tombstones — an unmount that stays unmounted", () => {
  it("records a deliberate unmount, and drops the mount in the same write", async () => {
    await addMountedVault(v("v1"));
    await addMountedVault(v("v2"));

    await unmountVault("v1");

    expect(readMountedVaults().map((m) => m.vaultId)).toEqual(["v2"]);
    expect(readUnmountedVaults()).toEqual(["v1"]);
  });

  it("does not tombstone a plain removal", async () => {
    // trashVault uses this: the vault was deleted in the CLOUD, which is not a
    // decision about this machine. Reclaim cannot resurrect it anyway — the
    // cloud list no longer names it — and a tombstone would outlive the vault.
    await addMountedVault(v("v1"));
    await removeMountedVault("v1");

    expect(readMountedVaults()).toEqual([]);
    expect(readUnmountedVaults()).toEqual([]);
  });

  it("forgets the tombstone when the vault is mounted again", async () => {
    // Mounting is consent, so it has to be the undo. Enforced inside the locked
    // update rather than left to callers: "mounted" and "tombstoned" cannot
    // both be true, and no caller has to remember that.
    await addMountedVault(v("v1"));
    await unmountVault("v1");
    expect(readUnmountedVaults()).toEqual(["v1"]);

    await addMountedVault(v("v1", "/somewhere-new"));

    expect(readUnmountedVaults()).toEqual([]);
    expect(readMountedVaults()).toHaveLength(1);
  });

  it("will not let a legacy list resurrect a vault that was unmounted", async () => {
    // adoptLegacyVaults folds a process's own old list into the registry. A
    // stale copy naming a vault the user has since unmounted is the same bug as
    // reclaim, in a different coat.
    await addMountedVault(v("v1"));
    await unmountVault("v1");

    const adopted = await adoptLegacyVaults([v("v1"), v("v2")]);

    expect(adopted).toEqual(["v2"]);
    expect(readMountedVaults().map((m) => m.vaultId)).toEqual(["v2"]);
    expect(readUnmountedVaults()).toEqual(["v1"]);
  });

  it("keeps tombstones through a write that does not own them", async () => {
    await addMountedVault(v("v1"));
    await unmountVault("v1");

    await addMountedVault(v("v2"));

    expect(readUnmountedVaults()).toEqual(["v1"]);
    const after = JSON.parse(readFileSync(registry, "utf8"));
    expect(after.unmounted).toEqual(["v1"]);
  });

  it("does not list the same tombstone twice", async () => {
    await addMountedVault(v("v1"));
    await unmountVault("v1");
    await unmountVault("v1"); // already gone; saying so again changes nothing

    expect(readUnmountedVaults()).toEqual(["v1"]);
  });

  it("reads an absent or unreadable registry as no tombstones", async () => {
    expect(readUnmountedVaults()).toEqual([]);
    writeFileSync(registry, "{ not json");
    expect(readUnmountedVaults()).toEqual([]);
  });
});

describe("the saved instance", () => {
  // `markbase instance <url>` and the desktop app's "Connect to a team
  // instance" both write the three keys here, and both read them at launch.
  // The write is a merge like every other: the key, the mirror directory and
  // the mounts belong to other writers and must come through unchanged.
  const acme = {
    appUrl: "https://markbase.acme.internal",
    supabaseUrl: "https://ref.supabase.co",
    supabaseKey: "sb_publishable_x",
  };

  it("is null until one is saved", () => {
    expect(readSavedInstance()).toBeNull();
  });

  it("keeps what the other clients wrote", async () => {
    writeFileSync(
      registry,
      JSON.stringify({ apiKey: "jsk_1", mirrorDir: "/m", vaults: [v("v1")], unmounted: ["v2"] })
    );

    await saveInstance(acme);

    expect(readSavedInstance()).toEqual(acme);
    const after = JSON.parse(readFileSync(registry, "utf8"));
    expect(after.apiKey).toBe("jsk_1");
    expect(after.mirrorDir).toBe("/m");
    expect(after.vaults).toEqual([v("v1")]);
    expect(after.unmounted).toEqual(["v2"]);
  });

  it("replaces a previous instance whole", async () => {
    await saveInstance(acme);
    await saveInstance({ ...acme, appUrl: "https://markbase.so", supabaseKey: "sb_publishable_y" });
    expect(readSavedInstance()?.supabaseKey).toBe("sb_publishable_y");
  });

  it("reads a URL without its project as no instance", () => {
    // The window would go to one instance and the live document channel to
    // another. The CLI's older writes never did this; a hand edit can.
    writeFileSync(registry, JSON.stringify({ appUrl: acme.appUrl }));
    expect(readSavedInstance()).toBeNull();
  });
});
