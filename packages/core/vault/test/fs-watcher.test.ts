import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ignoredByWatcher } from "../src/vault-boundary";
import { watchVault, type VaultWatcher } from "../src/fs-watcher";

// One recursive fs.watch on the root, and the daemon's add / change / unlink
// vocabulary rebuilt on top of it. Real files in a temp folder: the OS is the
// thing under test as much as the code.

const made: Array<{ dir: string; w: VaultWatcher }> = [];
afterEach(async () => {
  for (const { dir, w } of made.splice(0)) {
    await w.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A vault folder with a watcher on it; events collected as vault-relative paths. */
async function vault(known: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "fs-watcher-"));
  const events: string[] = [];
  const w = watchVault(dir, { ignored: (p) => ignoredByWatcher(p), known, settleMs: 20 });
  for (const ev of ["add", "change", "unlink"] as const) {
    w.on(ev, (p) => events.push(`${ev} ${p.slice(dir.length + 1)}`));
  }
  made.push({ dir, w });
  // fs.watch is live once it returns, but give FSEvents a beat to attach.
  await new Promise((r) => setTimeout(r, 150));
  return { dir, events };
}

async function waitFor(what: () => boolean, ms = 4000): Promise<void> {
  const until = Date.now() + ms;
  while (!what()) {
    if (Date.now() > until) throw new Error("timed out waiting for the watcher");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 300));

describe("a file's life", () => {
  it("is an add, then changes, then an unlink", async () => {
    const v = await vault();
    writeFileSync(join(v.dir, "note.md"), "# one\n");
    await waitFor(() => v.events.includes("add note.md"));
    writeFileSync(join(v.dir, "note.md"), "# one\n\ntwo\n");
    await waitFor(() => v.events.includes("change note.md"));
    rmSync(join(v.dir, "note.md"));
    await waitFor(() => v.events.includes("unlink note.md"));
    expect(v.events.filter((e) => e.endsWith(" note.md"))).toEqual([
      "add note.md",
      "change note.md",
      "unlink note.md",
    ]);
  });

  it("reports a file that was already there as changed, and its removal as an unlink", async () => {
    const v = await vault(["old.md"]);
    writeFileSync(join(v.dir, "old.md"), "edited\n");
    await waitFor(() => v.events.includes("change old.md"));
    rmSync(join(v.dir, "old.md"));
    await waitFor(() => v.events.includes("unlink old.md"));
    expect(v.events).not.toContain("add old.md");
  });

  it("sees an editor's atomic save as a change, never as an unlink", async () => {
    const v = await vault(["doc.md"]);
    writeFileSync(join(v.dir, "doc.md"), "v1\n");
    await waitFor(() => v.events.includes("change doc.md"));
    // Write beside, then rename over: the path never stops existing.
    writeFileSync(join(v.dir, "doc.md.tmp"), "v2\n");
    renameSync(join(v.dir, "doc.md.tmp"), join(v.dir, "doc.md"));
    await settle();
    expect(v.events).not.toContain("unlink doc.md");
    expect(v.events.filter((e) => e === "change doc.md").length).toBeGreaterThanOrEqual(2);
  });
});

describe("directories", () => {
  it("reports every file inside a folder that appears, and inside one that goes", async () => {
    const v = await vault();
    const staging = mkdtempSync(join(tmpdir(), "fs-watcher-stage-"));
    mkdirSync(join(staging, "notes", "deep"), { recursive: true });
    writeFileSync(join(staging, "notes", "a.md"), "a");
    writeFileSync(join(staging, "notes", "deep", "b.md"), "b");
    renameSync(join(staging, "notes"), join(v.dir, "notes")); // moved in whole
    await waitFor(() => v.events.includes("add notes/a.md") && v.events.includes("add notes/deep/b.md"));
    rmSync(join(v.dir, "notes"), { recursive: true });
    await waitFor(() => v.events.includes("unlink notes/a.md") && v.events.includes("unlink notes/deep/b.md"));
    rmSync(staging, { recursive: true, force: true });
  });
});

describe("what it ignores", () => {
  it("drops dot-noise and generated folders, but delivers a vault marker", async () => {
    const v = await vault();
    mkdirSync(join(v.dir, ".git"), { recursive: true });
    mkdirSync(join(v.dir, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(v.dir, "Personal", ".markbase"), { recursive: true });
    writeFileSync(join(v.dir, ".git", "config"), "x");
    writeFileSync(join(v.dir, "node_modules", "pkg", "README.md"), "x");
    writeFileSync(join(v.dir, "Personal", ".markbase", "vault.json"), "{}");
    writeFileSync(join(v.dir, "Personal", "kept.md"), "x");
    await waitFor(() => v.events.includes("add Personal/kept.md"));
    await waitFor(() => v.events.includes("add Personal/.markbase/vault.json"));
    expect(v.events.some((e) => e.includes(".git/"))).toBe(false);
    expect(v.events.some((e) => e.includes("node_modules/"))).toBe(false);
  });

  it("reports nothing once closed", async () => {
    const v = await vault();
    await made[made.length - 1].w.close();
    writeFileSync(join(v.dir, "late.md"), "x");
    await settle();
    expect(v.events).toEqual([]);
  });
});
