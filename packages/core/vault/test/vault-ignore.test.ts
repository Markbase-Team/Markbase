import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DEFAULT_IGNORE,
  IGNORE_FILE,
  emptyIgnore,
  loadVaultIgnore,
  parseIgnore,
} from "../src/vault-ignore";

// These rules decide what a vault does NOT hold. Getting them wrong in one
// direction fills the cloud with a dependency tree — 735 node_modules READMEs,
// the failure that put this file here — and in the other silently drops a
// document somebody wrote.

const dirs: string[] = [];
const vault = (): string => {
  const d = mkdtempSync(join(tmpdir(), "ignore-"));
  dirs.push(d);
  return d;
};

/** Write the rules by hand, as a user editing the file would. */
const putIgnore = (dir: string, text: string): void => {
  const at = join(dir, IGNORE_FILE);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, text);
};

describe("the defaults still cover what the constant used to", () => {
  const ig = parseIgnore(DEFAULT_IGNORE);

  it("hides dependency trees at any depth", () => {
    expect(ig.ignores("node_modules/react/README.md")).toBe(true);
    expect(ig.ignores("apps/web/node_modules/x/readme.md")).toBe(true);
    expect(ig.ignores("vendor/x/README.md")).toBe(true);
    expect(ig.ignores("py/site-packages/pkg/doc.md")).toBe(true);
    expect(ig.ignores("ios/Pods/Thing/README.md")).toBe(true);
  });

  it("hides build output at any depth", () => {
    expect(ig.ignores("NeuroSpark-Awesome-Skill/dist/skill.md")).toBe(true);
    expect(ig.ignores("api/build/notes.md")).toBe(true);
    expect(ig.ignores("web/out/index.md")).toBe(true);
    expect(ig.ignores("rust/target/doc.md")).toBe(true);
  });

  it("leaves real documents alone", () => {
    expect(ig.ignores("docs/guide.md")).toBe(false);
    expect(ig.ignores("inbox.md")).toBe(false);
    expect(ig.ignores("projects/2026/q1.md")).toBe(false);
  });

  it("does not hide a document whose name merely contains a rule", () => {
    expect(ig.ignores("notes/building-a-vault.md")).toBe(false);
    expect(ig.ignores("distribution-plan.md")).toBe(false);
    expect(ig.ignores("about-node_modules.md")).toBe(false);
  });
});

describe("pattern shapes", () => {
  it("a bare name matches at any depth", () => {
    const ig = parseIgnore("tmp");
    expect(ig.ignores("tmp/a.md")).toBe(true);
    expect(ig.ignores("deep/nested/tmp/a.md")).toBe(true);
  });

  it("a leading slash anchors to the vault root", () => {
    const ig = parseIgnore("/build");
    expect(ig.ignores("build/x.md")).toBe(true);
    expect(ig.ignores("apps/build/x.md")).toBe(false);
  });

  it("a trailing slash matches directories, not files of that name", () => {
    const ig = parseIgnore("cache/");
    expect(ig.ignores("cache/a.md")).toBe(true); // inside it
    expect(ig.ignores("cache", true)).toBe(true); // the directory itself
    expect(ig.ignores("cache")).toBe(false); // a FILE called "cache"
  });

  it("a star stays inside one segment", () => {
    const ig = parseIgnore("*.log.md");
    expect(ig.ignores("run.log.md")).toBe(true);
    expect(ig.ignores("deep/run.log.md")).toBe(true);
    expect(ig.ignores("notes.md")).toBe(false);
  });

  it("a pattern with a slash is a path from the root", () => {
    const ig = parseIgnore("docs/generated");
    expect(ig.ignores("docs/generated/a.md")).toBe(true);
    expect(ig.ignores("apps/docs/generated/a.md")).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const ig = parseIgnore("# a comment\n\n   \nnode_modules\n");
    expect(ig.size).toBe(1);
    expect(ig.ignores("node_modules/x.md")).toBe(true);
  });

  it("an empty rule set hides nothing", () => {
    expect(emptyIgnore().ignores("node_modules/x.md")).toBe(false);
    expect(parseIgnore("").ignores("anything.md")).toBe(false);
  });
});

describe("the file in the vault", () => {
  it("is written with the defaults when a vault has none", () => {
    const dir = vault();
    const ig = loadVaultIgnore(dir);
    expect(existsSync(join(dir, IGNORE_FILE))).toBe(true);
    expect(readFileSync(join(dir, IGNORE_FILE), "utf8")).toBe(DEFAULT_IGNORE);
    expect(ig.ignores("node_modules/x.md")).toBe(true);
  });

  it("is read as written — the user's edits are the rules", () => {
    const dir = vault();
    putIgnore(dir, "datasets/\n");
    const ig = loadVaultIgnore(dir);
    expect(ig.ignores("datasets/big.md")).toBe(true);
    // They removed the defaults on purpose; do not put them back.
    expect(ig.ignores("node_modules/x.md")).toBe(false);
  });

  it("falls back to the defaults rather than syncing everything", () => {
    // A folder that cannot be read or written: the answer must not become
    // "nothing is ignored", which is what fills a vault with a dependency tree.
    const ig = loadVaultIgnore("/definitely/not/a/folder/here");
    expect(ig.ignores("node_modules/x.md")).toBe(true);
  });

  it("sits at the root, where an ignore file is looked for", () => {
    const dir = vault();
    loadVaultIgnore(dir);
    expect(IGNORE_FILE).toBe(".markbaseignore");
    expect(existsSync(join(dir, ".markbaseignore"))).toBe(true);
  });

  it("does not rewrite a file that is already there", () => {
    const dir = vault();
    putIgnore(dir, "# mine\ntmp/\n");
    loadVaultIgnore(dir);
    expect(readFileSync(join(dir, IGNORE_FILE), "utf8")).toBe("# mine\ntmp/\n");
  });
});

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
