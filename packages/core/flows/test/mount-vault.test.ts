import { describe, it, expect, vi } from "vitest";
import { mountVault, folderRefusal, ADOPT_WARN_AT, type MountVaultDeps } from "../src/mount-vault";
import { unattendedOperator, type Operator } from "../src/operator";
import { fakeRegistry } from "./fake-registry";

// Mounting a vault to a folder, written once for every client.
//
// The desktop app and the CLI both did this, differently: ~15 functions in the
// Electron main process against `markbase vault mount`. The steps were the same
// — resolve a folder, check it may hold this vault, register it, start syncing —
// and only the asking differed. So the steps live here and the asking is an
// Operator.
//
// One behaviour changes in the move, deliberately: the desktop warned before
// adopting a large folder and the CLI did not. main.ts records why — a vault
// pointed at a source repo created 398 documents in twenty minutes. Every client
// gets that warning now, which means a headless one refuses rather than uploads.
//
// Registering used to mean handing over a whole list: readMounted() at the top,
// writeMounted([...those, mine]) at the bottom. Everything decided in between —
// a folder picker, a warning about 398 files — is time another process can write
// in, and its entry was gone the moment this one finished. Now the flow hands
// over a change instead of a result, and the registry applies it under its lock.

/** An operator that answers however the test says, and records what it was asked. */
function fakeOperator(answers: {
  approve?: boolean;
  folder?: string | null;
  /** Runs while the folder dialog is "open" — what another process did meanwhile. */
  whileChoosing?: () => void;
} = {}) {
  const asked = {
    approvals: [] as { action: string; detail?: string }[],
    folders: [] as { purpose: string; startAt?: string }[],
    events: [] as { level: string; message: string }[],
  };
  const op: Operator = {
    approve: vi.fn(async (r) => {
      asked.approvals.push({ action: r.action, detail: r.detail });
      return answers.approve ?? false;
    }),
    chooseOption: vi.fn(async () => null),
    chooseFolder: vi.fn(async (r) => {
      asked.folders.push({ purpose: r.purpose, startAt: r.startAt });
      answers.whileChoosing?.();
      return answers.folder ?? null;
    }),
    reportEvent: vi.fn((e) => asked.events.push({ level: e.level, message: e.message })),
    reportProgress: vi.fn(),
  };
  return { op, asked };
}

function deps(over: Partial<MountVaultDeps> = {}): MountVaultDeps {
  return {
    // Defaulted because `operator` is REQUIRED by MountVaultDeps and this helper
    // never supplied it — every caller that cares passes its own through `over`.
    // The gap was invisible until test/ started being typechecked.
    operator: fakeOperator().op,
    readMounted: () => [],
    updateMounted: vi.fn(async (next) => next([])),
    markerOf: () => null,
    countMarkdown: () => 0,
    startSync: vi.fn(),
    defaultHome: "/Users/test/Markbase",
    ...over,
  };
}

describe("mountVault", () => {
  it("is a no-op when the vault already has a folder here", async () => {
    const d = deps({
      readMounted: () => [{ vaultId: "v1", name: "Blog", dir: "/existing" }],
    });
    const { op } = fakeOperator();
    const res = await mountVault({ vaultId: "v1", name: "Blog" }, { ...d, operator: op });
    expect(res).toEqual({ ok: true, dir: "/existing" });
    expect(d.updateMounted).not.toHaveBeenCalled();
    expect(d.startSync).not.toHaveBeenCalled();
    expect(op.chooseFolder).not.toHaveBeenCalled();
  });

  it("asks for a folder, naming the vault", async () => {
    const { op, asked } = fakeOperator({ folder: "/Users/test/Blog" });
    const d = deps();
    const res = await mountVault({ vaultId: "v1", name: "Blog" }, { ...d, operator: op });
    expect(asked.folders[0].purpose).toContain("Blog");
    expect(res.ok).toBe(true);
  });

  it("suggests the default home for the first vault, and not otherwise", async () => {
    const first = fakeOperator({ folder: "/somewhere" });
    await mountVault(
      { vaultId: "v1", name: "Blog", isFirstVault: true },
      { ...deps(), operator: first.op }
    );
    expect(first.asked.folders[0].startAt).toBe("/Users/test/Markbase");

    const later = fakeOperator({ folder: "/somewhere" });
    await mountVault(
      { vaultId: "v2", name: "Stocks" },
      { ...deps(), operator: later.op }
    );
    expect(later.asked.folders[0].startAt).toBeUndefined();
  });

  it("gives up quietly when no folder is chosen", async () => {
    const { op } = fakeOperator({ folder: null });
    const d = deps();
    const res = await mountVault({ vaultId: "v1", name: "Blog" }, { ...d, operator: op });
    expect(res).toEqual({ ok: false, reason: "canceled" });
    expect(d.updateMounted).not.toHaveBeenCalled();
  });

  it("does not ask about a folder that holds few files", async () => {
    const { op } = fakeOperator();
    const d = deps({ countMarkdown: () => ADOPT_WARN_AT });
    const res = await mountVault(
      { vaultId: "v1", name: "Blog", dir: "/notes" },
      { ...d, operator: op }
    );
    expect(op.approve).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it("says how many files a big folder holds before adopting any of them", async () => {
    const { op, asked } = fakeOperator({ approve: true });
    const d = deps({ countMarkdown: () => 398 });
    const res = await mountVault(
      { vaultId: "v1", name: "Blog", dir: "/repo" },
      { ...d, operator: op }
    );
    expect(asked.approvals[0].action).toContain("398");
    expect(asked.approvals[0].detail).toContain("Blog");
    expect(res.ok).toBe(true);
    expect(d.startSync).toHaveBeenCalledTimes(1);
  });

  it("mounts nothing when the big-folder warning is declined", async () => {
    const { op } = fakeOperator({ approve: false });
    const d = deps({ countMarkdown: () => 398 });
    const res = await mountVault(
      { vaultId: "v1", name: "Blog", dir: "/repo" },
      { ...d, operator: op }
    );
    expect(res).toEqual({ ok: false, reason: "declined" });
    expect(d.updateMounted).not.toHaveBeenCalled();
    expect(d.startSync).not.toHaveBeenCalled();
  });

  it("refuses a folder that belongs to another vault, and says so", async () => {
    const { op, asked } = fakeOperator();
    const d = deps({ markerOf: () => "someone-elses-vault" });
    const res = await mountVault(
      { vaultId: "v1", name: "Blog", dir: "/taken" },
      { ...d, operator: op }
    );
    expect(res.ok).toBe(false);
    expect(asked.events[0].level).toBe("error");
    expect(asked.events[0].message).toMatch(/another vault/i);
    expect(d.updateMounted).not.toHaveBeenCalled();
  });

  it("refuses a folder inside a mounted vault, and explains what it really is", async () => {
    const { op, asked } = fakeOperator();
    const d = deps({
      readMounted: () => [{ vaultId: "other", name: "NeuroSpark", dir: "/Users/test/ns" }],
    });
    const res = await mountVault(
      { vaultId: "v1", name: "Blog", dir: "/Users/test/ns/inside" },
      { ...d, operator: op }
    );
    expect(res.ok).toBe(false);
    const said = asked.events.map((e) => e.message).join(" ");
    expect(said).toContain("NeuroSpark");

    // The old message said "Vaults can't be nested", which is not the rule and
    // never was: a folder carrying its own marker mounts inside another vault
    // every time someone drags one in Finder — see checkMount, "identity beats
    // location". What is actually refused is an UNMARKED folder, because those
    // files already belong to NeuroSpark and a second sync root over them is
    // the one thing that corrupts.
    expect(said).not.toMatch(/can.t be nested/i);
    expect(said).toMatch(/already part of/i);

    // And it points at the operation the user actually wants. The convert route
    // says so itself: "mounting a plain folder inside a vault is refused — this
    // is what that refusal points at".
    expect(said).toMatch(/convert/i);
    expect(d.updateMounted).not.toHaveBeenCalled();
  });

  it("says which way round the overlap is when the folder CONTAINS a vault", async () => {
    const { op, asked } = fakeOperator();
    const d = deps({
      readMounted: () => [{ vaultId: "other", name: "NeuroSpark", dir: "/Users/test/ns" }],
    });
    const res = await mountVault(
      { vaultId: "v1", name: "Blog", dir: "/Users/test" },
      { ...d, operator: op }
    );
    expect(res.ok).toBe(false);
    const said = asked.events.map((e) => e.message).join(" ");
    // Containing a vault is a different mistake from being inside one, and
    // converting is not the answer to it — so the advice must differ too.
    expect(said).toMatch(/contains/i);
    expect(said).toContain("NeuroSpark");
    expect(said).not.toMatch(/convert/i);
  });

  it("registers the vault alongside the others, and starts syncing once", async () => {
    const existing = { vaultId: "other", name: "NeuroSpark", dir: "/Users/test/ns" };
    const reg = fakeRegistry([existing]);
    const d = deps({ readMounted: reg.read, updateMounted: reg.update });
    const { op } = fakeOperator();
    const res = await mountVault(
      { vaultId: "v1", name: "Blog", dir: "/Users/test/blog" },
      { ...d, operator: op }
    );
    expect(res).toEqual({ ok: true, dir: "/Users/test/blog" });
    expect(reg.list).toEqual([
      existing,
      { vaultId: "v1", name: "Blog", dir: "/Users/test/blog" },
    ]);
    expect(d.startSync).toHaveBeenCalledTimes(1);
    expect(d.startSync).toHaveBeenCalledWith({
      vaultId: "v1",
      name: "Blog",
      dir: "/Users/test/blog",
    });
  });

  it("keeps a vault another process mounted while this one was choosing a folder", async () => {
    // The lost update, exactly: this flow read the list, then a folder picker sat
    // open for as long as someone took to answer. `markbase vault mount` in
    // another terminal — or the desktop app — finished in that window.
    const existing = { vaultId: "other", name: "NeuroSpark", dir: "/Users/test/ns" };
    const late = { vaultId: "late", name: "Stocks", dir: "/Users/test/stocks" };
    const reg = fakeRegistry([existing]);
    const { op } = fakeOperator({
      folder: "/Users/test/blog",
      whileChoosing: () => reg.concurrentlyAdd(late),
    });
    const d = deps({ readMounted: reg.read, updateMounted: reg.update });

    await mountVault({ vaultId: "v1", name: "Blog" }, { ...d, operator: op });

    // Writing back a list computed before the picker opened would drop `late`
    // without a word — no error, no log, just a vault that stopped syncing.
    expect(reg.list.map((v) => v.vaultId).sort()).toEqual(["late", "other", "v1"]);
  });

  it("moves a vault rather than listing it twice, even after a concurrent write", async () => {
    // Re-mounting is how a vault is pointed somewhere new. The merge has to
    // replace this vault's entry in the CURRENT list, not append to a stale one.
    const old = { vaultId: "v1", name: "Blog", dir: "/old" };
    const reg = fakeRegistry([old]);
    const d = deps({
      // What the desktop and CLI both pass: everything except this vault, so the
      // boundary check does not refuse the folder as its own.
      readMounted: () => reg.read().filter((m) => m.vaultId !== "v1"),
      updateMounted: reg.update,
    });
    const { op } = fakeOperator();

    await mountVault({ vaultId: "v1", name: "Blog", dir: "/new" }, { ...d, operator: op });

    expect(reg.list).toEqual([{ vaultId: "v1", name: "Blog", dir: "/new" }]);
  });

  it("on a headless machine, refuses the big folder instead of uploading it", async () => {
    const d = deps({ countMarkdown: () => 398 });
    const res = await mountVault(
      { vaultId: "v1", name: "Blog", dir: "/repo" },
      { ...d, operator: unattendedOperator({ log: () => {} }) }
    );
    expect(res).toEqual({ ok: false, reason: "declined" });
    expect(d.updateMounted).not.toHaveBeenCalled();
  });
});

// The registry is machine-wide, and until a mount said whose it was every
// process on the machine synced every entry under whatever key it held — which
// is how one account's folders were uploaded as another account's documents
// (2026-10-30). A mount made by a signed-in client is that account's from the
// moment it is written.
describe("mountVault records whose mount it is", () => {
  it("writes the mounting account on the registry entry", async () => {
    const reg = fakeRegistry();
    const d = deps({ readMounted: reg.read, updateMounted: reg.update });
    const r = await mountVault({ vaultId: "v1", name: "Blog", dir: "/Blog", ownerId: "owner-1" }, d);
    expect(r.ok).toBe(true);
    expect(reg.list).toEqual([{ vaultId: "v1", name: "Blog", dir: "/Blog", ownerId: "owner-1" }]);
  });

  it("writes no owner when the client could not resolve one — the daemon records it later", async () => {
    const reg = fakeRegistry();
    const d = deps({ readMounted: reg.read, updateMounted: reg.update });
    await mountVault({ vaultId: "v1", name: "Blog", dir: "/Blog", ownerId: null }, d);
    expect(reg.list[0]).not.toHaveProperty("ownerId");
  });
});

// Create means create. The New Vault dialog shows ~/Markbase/<name> as the
// default, so when nobody picked a folder that is where the vault goes — the
// picker opening anyway read as "the mount did not happen". And the home itself
// is not a vault: it is where every vault gets a folder of its own.
describe("the default folder", () => {
  it("uses defaultDir without asking when no folder was chosen", async () => {
    const { op } = fakeOperator();
    const reg = fakeRegistry();
    const d = deps({ operator: op, readMounted: reg.read, updateMounted: reg.update });
    const r = await mountVault(
      { vaultId: "v1", name: "Init", defaultDir: "/Users/test/Markbase/Init", isFirstVault: true },
      d
    );
    expect(r).toEqual({ ok: true, dir: "/Users/test/Markbase/Init" });
    expect(op.chooseFolder).not.toHaveBeenCalled();
    expect(reg.list[0].dir).toBe("/Users/test/Markbase/Init");
  });

  it("still asks when neither a folder nor a default was given", async () => {
    const { op } = fakeOperator({ folder: "/Users/test/Elsewhere" });
    const d = deps({ operator: op });
    const r = await mountVault({ vaultId: "v1", name: "Init" }, d);
    expect(op.chooseFolder).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, dir: "/Users/test/Elsewhere" });
  });

  it("refuses the home itself, and says what it is", async () => {
    const { op, asked } = fakeOperator({ folder: "/Users/test/Markbase/" });
    const d = deps({ operator: op });
    const r = await mountVault({ vaultId: "v1", name: "Init", isFirstVault: true }, d);
    expect(r).toEqual({ ok: false, reason: "refused" });
    expect(d.updateMounted).not.toHaveBeenCalled();
    expect(asked.events.map((e) => e.message).join(" ")).toMatch(/where your vaults live/);
  });
});

// The same check, before the vault exists: the desktop's New Vault dialog picks
// the folder first and creates the row after, so a folder that is refused has
// to be refused at the pick — a vault created and then told "no" is the bug
// this guards against (2026-11-05).
describe("folderRefusal", () => {
  const mounted = [{ vaultId: "v-notes", name: "Notes", dir: "/home/me/Markbase/Notes" }];
  const noMarker = () => null;

  it("allows an empty folder of its own", () => {
    expect(folderRefusal("/home/me/Markbase/Work", "", "Work", mounted, noMarker, "/home/me/Markbase")).toBeNull();
  });

  it("refuses another vault's folder, with or without its marker", () => {
    expect(folderRefusal("/home/me/Markbase/Notes", "", "Work", mounted, noMarker)).toMatch(/"Notes"'s own folder/);
    expect(folderRefusal("/elsewhere", "", "Work", [], () => "v-other")).toMatch(/already belongs to another vault/);
  });

  it("refuses a folder inside, or containing, another vault", () => {
    expect(folderRefusal("/home/me/Markbase/Notes/sub", "", "Work", mounted, noMarker)).toMatch(/already part of "Notes"/);
    expect(folderRefusal("/home/me", "", "Work", mounted, noMarker)).toMatch(/contains "Notes"/);
  });

  it("refuses the home itself, by name", () => {
    expect(folderRefusal("/home/me/Markbase", "", "Work", [], noMarker, "/home/me/Markbase")).toMatch(/can't be a vault itself/);
  });

  it("lets a vault back into a folder carrying its own marker", () => {
    expect(folderRefusal("/home/me/Markbase/Notes", "v-notes", "Notes", mounted, () => "v-notes")).toBeNull();
  });
});
