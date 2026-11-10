import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";

// Every read of a folder's marker goes through this, so a test can say which
// folders were looked at — the point of the account check is that another
// account's folder is never one of them.
const markerReads: string[] = [];
vi.mock("../src/vault-fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/vault-fs")>();
  return {
    ...actual,
    readVaultMarkerInfo: (dir: string) => {
      markerReads.push(dir);
      return actual.readVaultMarkerInfo(dir);
    },
  };
});
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VaultGoneError,
  VaultNotOursError,
  confirmMountAccount,
  recordedOwnerOf,
  type VaultOwnerAnswer,
} from "../src/vault-account";
import { readVaultMarker, readVaultMarkerInfo, writeVaultMarker } from "../src/vault-fs";
import {
  addMountedVault,
  mountsForAccount,
  readMountedVaults,
  setMountedVaultOwner,
  type MountedVault,
} from "../src/vault-registry";
import { SHARED_VAULT_ID } from "@markbase/protocol/shared-vault";

// Which account may sync which mount — the host's half of the account binding.
// The registry is machine-wide and the folder marker travels with the folder;
// both now name the account that mounted the vault, and a host that holds a
// key for a different account never starts a daemon for it.

let home: string;
let dir: string;

beforeEach(() => {
  markerReads.length = 0;
  home = mkdtempSync(join(tmpdir(), "mb-account-home-"));
  dir = mkdtempSync(join(tmpdir(), "mb-account-vault-"));
  process.env.MARKBASE_HOME = home;
});

afterEach(() => {
  delete process.env.MARKBASE_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

const mount = (over: Partial<MountedVault> = {}): MountedVault => ({
  vaultId: "v1",
  name: "Work",
  dir,
  ...over,
});

const answers = (map: Record<string, VaultOwnerAnswer>) => async (id: string): Promise<VaultOwnerAnswer> =>
  id in map ? map[id] : null;

const deps = (keyOwner: string | null, vaultOwner = answers({})) => ({
  appUrl: "http://x",
  apiKey: "k",
  keyOwner,
  vaultOwner,
});

describe("the marker carries the account", () => {
  it("keeps the recorded owner when rewritten without one", () => {
    writeVaultMarker(dir, "v1", "owner-1");
    writeVaultMarker(dir, "v1");
    expect(readVaultMarkerInfo(dir)).toEqual({ vaultId: "v1", ownerId: "owner-1" });
    expect(readVaultMarker(dir)).toBe("v1");
  });

  it("does not carry an owner across to a different vault id", () => {
    writeVaultMarker(dir, "v1", "owner-1");
    writeVaultMarker(dir, "v2");
    expect(readVaultMarkerInfo(dir)).toEqual({ vaultId: "v2" });
  });
});

describe("the registry carries the account", () => {
  it("records an owner once, and never overwrites one", async () => {
    await addMountedVault(mount());
    await setMountedVaultOwner("v1", "owner-1");
    await setMountedVaultOwner("v1", "owner-2");
    expect(readMountedVaults()[0].ownerId).toBe("owner-1");
  });

  it("filters mounts by account: another account's are hidden, unknown ones are not", () => {
    const all: MountedVault[] = [
      mount({ vaultId: "mine", ownerId: "owner-1" }),
      mount({ vaultId: "theirs", ownerId: "owner-2" }),
      mount({ vaultId: "legacy" }),
    ];
    expect(mountsForAccount(all, "owner-1").map((v) => v.vaultId)).toEqual(["mine", "legacy"]);
    // A host that does not know who its key belongs to hides nothing: the
    // daemon's own check decides, and offline it writes nothing.
    expect(mountsForAccount(all, null).map((v) => v.vaultId)).toEqual(["mine", "theirs", "legacy"]);
  });
});

describe("confirmMountAccount", () => {
  it("accepts a mount the registry records for the key's account, without reading the folder", async () => {
    await addMountedVault(mount({ ownerId: "owner-1" }));
    await expect(confirmMountAccount(mount(), deps("owner-1"))).resolves.toBe("owner-1");
    expect(markerReads).toEqual([]);
  });

  it("trusts a marker-only owner only once the API has confirmed the vault is this key's", async () => {
    // The folder says owner-1 but the registry entry predates owners (a reset
    // registry, a copied folder). The folder is not read on the marker's say-so
    // — the API is asked first; then the marker is checked and the registry caught up.
    writeVaultMarker(dir, "v1", "owner-1");
    await addMountedVault(mount());
    await expect(confirmMountAccount(mount(), deps("owner-1"))).resolves.toBeNull(); // no API answer yet
    expect(markerReads).toEqual([]);
    await expect(
      confirmMountAccount(mount(), deps("owner-1", answers({ v1: { ownerId: "owner-1" } })))
    ).resolves.toBe("owner-1");
    expect(readMountedVaults()[0].ownerId).toBe("owner-1");
  });

  it("refuses a mount recorded for another account, whatever the API would say", async () => {
    writeVaultMarker(dir, "v1", "owner-1");
    const err = await confirmMountAccount(mount(), deps("owner-2", answers({ v1: { ownerId: "owner-2" } }))).catch(
      (e: Error) => e
    );
    expect(err).toBeInstanceOf(VaultNotOursError);
    expect((err as VaultNotOursError).message).toContain("mounted by another account");
  });

  it("reads the account from the registry when the marker predates it", async () => {
    writeVaultMarker(dir, "v1");
    await addMountedVault(mount({ ownerId: "owner-1" }));
    expect(recordedOwnerOf(mount())).toBe("owner-1");
    await expect(confirmMountAccount(mount(), deps("owner-2"))).rejects.toBeInstanceOf(VaultNotOursError);
  });

  it("cannot decide a recorded mount while the key's owner is unknown", async () => {
    writeVaultMarker(dir, "v1", "owner-1");
    await expect(confirmMountAccount(mount(), deps(null))).resolves.toBeNull();
  });

  it("asks the API about an unrecorded mount and records the answer", async () => {
    writeVaultMarker(dir, "v1");
    await addMountedVault(mount());
    const got = await confirmMountAccount(mount(), deps("owner-1", answers({ v1: { ownerId: "owner-1" } })));
    expect(got).toBe("owner-1");
    expect(readVaultMarkerInfo(dir)).toEqual({ vaultId: "v1", ownerId: "owner-1" });
    expect(readMountedVaults()[0].ownerId).toBe("owner-1");
  });

  it("refuses an unrecorded mount the API says is not this key's, and records nothing", async () => {
    writeVaultMarker(dir, "v1");
    await addMountedVault(mount());
    await expect(confirmMountAccount(mount(), deps("owner-2", answers({ v1: "not-ours" })))).rejects.toBeInstanceOf(
      VaultNotOursError
    );
    expect(readVaultMarkerInfo(dir)).toEqual({ vaultId: "v1" });
    expect(readMountedVaults()[0].ownerId).toBeUndefined();
  });

  it("refuses an unrecorded mount whose vault is gone, with a different error, and records nothing", async () => {
    writeVaultMarker(dir, "v1");
    await addMountedVault(mount());
    const err = await confirmMountAccount(mount(), deps("owner-1", answers({ v1: "deleted" }))).catch((e: Error) => e);
    expect(err).toBeInstanceOf(VaultGoneError);
    expect((err as VaultGoneError).message).toContain("deleted in the cloud");
    expect(readMountedVaults()[0].ownerId).toBeUndefined();
  });

  it("never reads the folder of a mount the registry says is another account's", async () => {
    await addMountedVault(mount({ ownerId: "owner-1" }));
    await expect(confirmMountAccount(mount({ ownerId: "owner-1" }), deps("owner-2"))).rejects.toBeInstanceOf(
      VaultNotOursError
    );
    expect(markerReads).toEqual([]);
  });

  it("asks the API before it reads an unrecorded folder, so a refusal touches nothing", async () => {
    await addMountedVault(mount());
    await expect(confirmMountAccount(mount(), deps("owner-2", answers({ v1: "not-ours" })))).rejects.toBeInstanceOf(
      VaultNotOursError
    );
    await expect(confirmMountAccount(mount(), deps("owner-1", answers({ v1: "deleted" })))).rejects.toBeInstanceOf(
      VaultGoneError
    );
    expect(await confirmMountAccount(mount(), deps("owner-1"))).toBeNull(); // no answer
    expect(markerReads).toEqual([]);
    // Confirmed ours: now the folder is read, and written.
    await confirmMountAccount(mount(), deps("owner-1", answers({ v1: { ownerId: "owner-1" } })));
    expect(markerReads.length).toBeGreaterThan(0);
  });

  it("waits when the API gives no answer", async () => {
    writeVaultMarker(dir, "v1");
    await expect(confirmMountAccount(mount(), deps("owner-1"))).resolves.toBeNull();
    expect(readVaultMarkerInfo(dir)).toEqual({ vaultId: "v1" });
  });

  it("leaves a Shared Vault folder that already holds documents for the daemon to settle", async () => {
    const { writeVaultIndex } = await import("../src/vault-index");
    const shared = mount({ vaultId: SHARED_VAULT_ID, name: "Shared Vault" });
    await addMountedVault(shared);
    writeVaultIndex(dir, SHARED_VAULT_ID, [
      { id: "d1", title: "Plan", path: "Ada/Plan.md", file: "Ada/Plan.md", version: 1, updated_at: "" },
    ]);
    // Started (the key is allowed to try), but not recorded as anyone's yet.
    expect(await confirmMountAccount(shared, deps("owner-2"))).toBe("owner-2");
    expect(readMountedVaults()[0].ownerId).toBeUndefined();
    expect(readVaultMarkerInfo(dir)?.ownerId).toBeUndefined();
  });

  it("binds an empty Shared Vault folder to whoever mounted it, without asking the API", async () => {
    const shared = mount({ vaultId: SHARED_VAULT_ID, name: "Shared Vault" });
    await addMountedVault(shared);
    let asked = 0;
    const got = await confirmMountAccount(shared, {
      ...deps("owner-1"),
      vaultOwner: async () => {
        asked++;
        return null;
      },
    });
    expect(got).toBe("owner-1");
    expect(asked).toBe(0);
    expect(readMountedVaults()[0].ownerId).toBe("owner-1");
    await expect(confirmMountAccount(shared, deps("owner-2"))).rejects.toBeInstanceOf(VaultNotOursError);
  });
});
