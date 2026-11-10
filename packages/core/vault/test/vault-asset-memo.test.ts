import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDiskAssets, type AssetHashMemo } from "../src/vault-assets";

// Hashing reads the WHOLE file, and the asset pass runs every 15 seconds for as
// long as a vault is mounted: one folder was re-reading 791 MB four times a
// minute to recompute digests that had not changed. `stat` is 87x cheaper and
// answers the only question that matters — has this file moved on?

function vault(): string {
  return mkdtempSync(join(tmpdir(), "asset-memo-"));
}

describe("the asset hash memo", () => {
  it("returns the same hashes with or without a memo", () => {
    const root = vault();
    try {
      writeFileSync(join(root, "a.png"), "one");
      writeFileSync(join(root, "b.png"), "two");
      const plain = listDiskAssets(root);
      const memo: AssetHashMemo = new Map();
      expect(listDiskAssets(root, memo)).toEqual(plain);
      // And again from a warm memo — the answer must not drift on a second pass.
      expect(listDiskAssets(root, memo)).toEqual(plain);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("re-hashes a file whose contents changed", () => {
    const root = vault();
    try {
      writeFileSync(join(root, "a.png"), "before");
      const memo: AssetHashMemo = new Map();
      const first = listDiskAssets(root, memo)[0].sha256;

      writeFileSync(join(root, "a.png"), "after — a different length entirely");
      expect(listDiskAssets(root, memo)[0].sha256).not.toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("re-hashes when only the mtime moved, even at the same size", () => {
    const root = vault();
    try {
      writeFileSync(join(root, "a.png"), "12345");
      const memo: AssetHashMemo = new Map();
      listDiskAssets(root, memo);

      // Same byte count, different content, and a touched mtime — the ordinary
      // case for an edited image.
      writeFileSync(join(root, "a.png"), "54321");
      const st = statSync(join(root, "a.png"));
      utimesSync(join(root, "a.png"), st.atime, new Date(st.mtimeMs + 5000));
      expect(listDiskAssets(root, memo)[0].sha256).toBe(
        listDiskAssets(root).find((x) => x.path === "a.png")?.sha256
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The bet, stated out loud — and pinned through the memo rather than through the
  // filesystem clock. Seeding an entry that MATCHES the file's current stat proves
  // the exact property we are buying: when stat agrees, the file is not read.
  //
  // (Trying to construct this by resetting mtime does not work — mtimeMs carries
  // sub-millisecond precision that a JS Date cannot restore, so the memo notices.
  // The blind spot is real but narrower than "same size, same second".)
  it("trusts the memo when size and mtime both match, without reading the file", () => {
    const root = vault();
    try {
      const f = join(root, "a.png");
      writeFileSync(f, "the real bytes");
      const st = statSync(f);
      const memo: AssetHashMemo = new Map([
        ["a.png", { mtimeMs: st.mtimeMs, size: st.size, sha256: "sha-from-a-previous-pass" }],
      ]);

      // Returned verbatim: nothing re-read it to find out otherwise.
      expect(listDiskAssets(root, memo)[0].sha256).toBe("sha-from-a-previous-pass");
      // A cold memo — what a daemon restart gives you — reads and reports the truth.
      expect(listDiskAssets(root, new Map())[0].sha256).not.toBe("sha-from-a-previous-pass");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("forgets files that are gone, so the memo cannot grow forever", () => {
    const root = vault();
    try {
      writeFileSync(join(root, "a.png"), "one");
      writeFileSync(join(root, "b.png"), "two");
      const memo: AssetHashMemo = new Map();
      listDiskAssets(root, memo);
      expect(memo.size).toBe(2);

      rmSync(join(root, "b.png"));
      listDiskAssets(root, memo);
      expect(memo.size).toBe(1);
      expect(memo.has("b.png")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
