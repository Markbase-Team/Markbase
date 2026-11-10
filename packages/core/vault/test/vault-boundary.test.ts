import { describe, it, expect } from "vitest";
import {
  VAULT_MARKER,
  nestedVaultFor,
  pathsOverlap,
  markerPathFor,
  markerDirOf,
  ignoredByWatcher,
  checkMount,
} from "../src/vault-boundary";

// A vault root is marked by a file that TRAVELS WITH THE FOLDER. That's the whole
// point: a user can drag ~/Personal into ~/Work, and config-based defenses fail
// (the config still says ~/Personal) — but the marker moves with the bytes, so
// the outer vault can still tell "this subtree isn't mine".
//
// `markerOf(dir)` answers "which vault is rooted at this directory?" — the daemon
// backs it with the real filesystem; here it's a map.
const MINE = "vault-work";
const THEIRS = "vault-personal";

/** Build a markerOf() from a { dir: vaultId } map. "" is our own root. */
const markers = (m: Record<string, string>) => (dir: string) => m[dir] ?? null;

describe("nestedVaultFor — is this path inside someone else's vault?", () => {
  it("flags a vault dragged inside ours (the misoperation)", () => {
    // the user dropped ~/Personal into ~/Work
    const markerOf = markers({ "": MINE, Personal: THEIRS });
    expect(nestedVaultFor("Personal/notes.md", markerOf, MINE)).toBe("Personal");
    expect(nestedVaultFor("Personal/deep/further/x.md", markerOf, MINE)).toBe("Personal");
  });

  it("leaves our own files alone", () => {
    const markerOf = markers({ "": MINE, Personal: THEIRS });
    expect(nestedVaultFor("projects/roadmap.md", markerOf, MINE)).toBeNull();
    expect(nestedVaultFor("inbox.md", markerOf, MINE)).toBeNull();
  });

  it("never treats our OWN root marker as foreign", () => {
    // our root is marked too — that must not make every file of ours foreign
    const markerOf = markers({ "": MINE });
    expect(nestedVaultFor("a/b/c.md", markerOf, MINE)).toBeNull();
  });

  it("a nested folder marked with OUR id is not foreign", () => {
    const markerOf = markers({ "": MINE, sub: MINE });
    expect(nestedVaultFor("sub/x.md", markerOf, MINE)).toBeNull();
  });

  it("reports the OUTERMOST foreign root when vaults are nested twice", () => {
    const markerOf = markers({ "": MINE, a: THEIRS, "a/b": "vault-third" });
    // stop at the first boundary: everything under `a` is already not ours
    expect(nestedVaultFor("a/b/c.md", markerOf, MINE)).toBe("a");
  });

  it("is segment-aware — a 'Work' vault never swallows 'Workshop'", () => {
    const markerOf = markers({ "": MINE, Work: THEIRS });
    expect(nestedVaultFor("Workshop/x.md", markerOf, MINE)).toBeNull();
    expect(nestedVaultFor("Work/x.md", markerOf, MINE)).toBe("Work");
  });

  it("ignores a marker on the file's own name (only directories mark a vault)", () => {
    const markerOf = markers({ "": MINE, "notes.md": THEIRS });
    expect(nestedVaultFor("notes.md", markerOf, MINE)).toBeNull();
  });

  // CREATION: a marker appearing mid-flight must take effect immediately — a user
  // can turn a subfolder into a vault while we're running.
  it("a newly-created nested vault is foreign from that moment", () => {
    const before = markers({ "": MINE });
    expect(nestedVaultFor("sub/x.md", before, MINE)).toBeNull(); // ours until marked
    const after = markers({ "": MINE, sub: THEIRS }); // user made sub a vault
    expect(nestedVaultFor("sub/x.md", after, MINE)).toBe("sub");
  });

  // DELETION: once the nested vault's marker is gone, its files are plain files
  // in our vault again, and we may adopt them.
  it("a deleted nested vault's files become ours again", () => {
    const during = markers({ "": MINE, sub: THEIRS });
    expect(nestedVaultFor("sub/x.md", during, MINE)).toBe("sub");
    const after = markers({ "": MINE }); // marker removed with the nested vault
    expect(nestedVaultFor("sub/x.md", after, MINE)).toBeNull();
  });
});

describe("pathsOverlap — reject overlapping vault folders at config time", () => {
  it("rejects the same folder twice", () => {
    expect(pathsOverlap("/Users/j/Work", "/Users/j/Work")).toBe(true);
  });

  it("rejects a folder nested inside an existing vault", () => {
    expect(pathsOverlap("/Users/j/Work/Personal", "/Users/j/Work")).toBe(true);
  });

  it("rejects a folder that CONTAINS an existing vault", () => {
    expect(pathsOverlap("/Users/j", "/Users/j/Work")).toBe(true);
  });

  it("allows siblings", () => {
    expect(pathsOverlap("/Users/j/Work", "/Users/j/Personal")).toBe(false);
  });

  it("is segment-aware — /Work does not overlap /Workshop", () => {
    expect(pathsOverlap("/Users/j/Work", "/Users/j/Workshop")).toBe(false);
  });

  it("ignores trailing slashes", () => {
    expect(pathsOverlap("/Users/j/Work/", "/Users/j/Work")).toBe(true);
    expect(pathsOverlap("/Users/j/Work/", "/Users/j/Workshop/")).toBe(false);
  });
});

describe("marker location", () => {
  it("lives inside the vault folder and travels with it", () => {
    expect(VAULT_MARKER).toBe(".markbase/vault.json");
    expect(markerPathFor("/Users/j/Work")).toBe("/Users/j/Work/.markbase/vault.json");
  });
});

// A vault can be BORN inside ours — the user picks a subfolder and makes it a
// vault while we're running. The only evidence is a marker file appearing, so
// the watcher has to be able to see one.
// Mounting asks one question: may this vault sync to this folder? The blanket
// "no overlap, ever" rule was too blunt — it refused the one repair a user most
// needs. Drag ~/Personal into ~/Work and Personal is still Personal; its marker
// travelled with it and says so. Identity beats location: if the folder declares
// itself, believe it. Only an UNMARKED folder inside another vault is refused,
// because that's a convert, not a mount.
describe("checkMount — may this vault mount here?", () => {
  const WORK = { vaultId: "vault-work", name: "Work", dir: "/Users/j/Work" };
  const noMarker = () => null;

  it("allows a fresh folder that overlaps nothing", () => {
    expect(checkMount("/Users/j/Personal", THEIRS, [WORK], noMarker)).toEqual({ ok: true });
  });

  it("allows an empty folder outside every vault, even unmarked", () => {
    expect(checkMount("/Users/j/New", THEIRS, [], noMarker)).toEqual({ ok: true });
  });

  // The repair: Personal was dragged inside Work. Its marker came with it, so we
  // can point the mount at where it actually is — no re-download, no duplicates.
  it("allows a nested folder that carries THIS vault's marker (repointing after a drag)", () => {
    const marked = (d: string) => (d === "/Users/j/Work/Personal" ? THEIRS : null);
    expect(checkMount("/Users/j/Work/Personal", THEIRS, [WORK], marked)).toEqual({ ok: true });
  });

  it("refuses a folder that belongs to a DIFFERENT vault", () => {
    const marked = (d: string) => (d === "/Users/j/Somewhere" ? MINE : null);
    expect(checkMount("/Users/j/Somewhere", THEIRS, [], marked)).toEqual({
      ok: false,
      reason: "other-vault",
      vaultId: MINE,
    });
  });

  // Two sync roots over one file is the one thing that genuinely corrupts.
  //
  // The verdict says WHICH WAY the folders overlap, because the caller has to
  // tell the user something true. "inside (or contains)" was the old wording,
  // and it hedged because this type did not know — so every refusal read as
  // though we were not sure what the user had picked.
  it("refuses an UNMARKED folder inside a mounted vault — that's a convert", () => {
    expect(checkMount("/Users/j/Work/notes", THEIRS, [WORK], noMarker)).toEqual({
      ok: false,
      reason: "overlaps",
      relation: "inside",
      clashName: "Work",
      clashDir: "/Users/j/Work",
    });
  });

  it("refuses an unmarked folder that CONTAINS a mounted vault, and says so", () => {
    expect(checkMount("/Users/j", THEIRS, [WORK], noMarker)).toEqual({
      ok: false,
      reason: "overlaps",
      relation: "contains",
      clashName: "Work",
      clashDir: "/Users/j/Work",
    });
  });

  it("refuses an unmarked folder that IS another vault's folder", () => {
    // The marker is gone — deleted, or a folder restored from a backup without
    // it. The registry still says Work lives here, so mounting a second vault
    // on the same folder is the textbook two-roots-one-file case.
    expect(checkMount(WORK.dir, THEIRS, [WORK], noMarker)).toEqual({
      ok: false,
      reason: "overlaps",
      relation: "same",
      clashName: "Work",
      clashDir: WORK.dir,
    });
  });

  it("lets a vault be remounted at its own folder", () => {
    const marked = (d: string) => (d === WORK.dir ? WORK.vaultId : null);
    expect(checkMount(WORK.dir, WORK.vaultId, [WORK], marked)).toEqual({ ok: true });
  });

  it("is segment-aware — /Workshop is not inside /Work", () => {
    expect(checkMount("/Users/j/Workshop", THEIRS, [WORK], noMarker)).toEqual({ ok: true });
  });
});

describe("markerDirOf — which folder does this marker mark?", () => {
  it("recognises a nested vault's marker and names its folder", () => {
    expect(markerDirOf("Personal/.markbase/vault.json")).toBe("Personal");
    expect(markerDirOf("a/b/c/.markbase/vault.json")).toBe("a/b/c");
  });

  it("recognises our own root marker as the root", () => {
    expect(markerDirOf(".markbase/vault.json")).toBe("");
  });

  it("is not fooled by lookalikes", () => {
    expect(markerDirOf("notes.md")).toBeNull();
    expect(markerDirOf("vault.json")).toBeNull();
    expect(markerDirOf(".markbase/other.json")).toBeNull();
    expect(markerDirOf("markbase/vault.json")).toBeNull(); // no dot
    expect(markerDirOf("a/.markbase/vault.json/x.md")).toBeNull();
  });
});

describe("ignoredByWatcher — dotfiles are noise, the marker is not", () => {
  it("ignores the dot-dirs a vault folder collects", () => {
    expect(ignoredByWatcher(".git/config")).toBe(true);
    expect(ignoredByWatcher(".trash/old.md")).toBe(true);
    expect(ignoredByWatcher(".obsidian/workspace.json")).toBe(true);
    expect(ignoredByWatcher("sub/.DS_Store")).toBe(true);
  });

  it("watches ordinary files", () => {
    expect(ignoredByWatcher("")).toBe(false); // the root itself
    expect(ignoredByWatcher("inbox.md")).toBe(false);
    expect(ignoredByWatcher("projects/2026/q1.md")).toBe(false);
  });

  // Without this the daemon is blind to a vault created inside it: the marker
  // lives under a dot-dir, so the old "ignore anything dotted" rule dropped the
  // one event that announces a new boundary.
  it("watches the marker — and the dir it must descend into to reach it", () => {
    expect(ignoredByWatcher(".markbase")).toBe(false);
    expect(ignoredByWatcher(".markbase/vault.json")).toBe(false);
    expect(ignoredByWatcher("Personal/.markbase")).toBe(false);
    expect(ignoredByWatcher("Personal/.markbase/vault.json")).toBe(false);
  });

  it("still ignores everything else in the marker's dir", () => {
    expect(ignoredByWatcher(".markbase/cache.db")).toBe(true);
    expect(ignoredByWatcher(".markbase/nested/vault.json")).toBe(true);
  });
});
