import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The scan over Claude Code's session logs used to probe every folder Claude
// Code had ever run in — existsSync, then git — which on a Mac reaches into
// Desktop and Documents and has macOS ask whether Markbase may read folders
// nobody pointed it at. A pass now names the folders it may look in; a
// session recorded anywhere else is neither probed nor reported.

const touched: string[] = [];
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (p: string) => {
      touched.push(String(p));
      return actual.existsSync(p);
    },
  };
});

const { discoverClaude } = await import("../src/discover-repos");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  touched.length = 0;
});

/** A fake ~/.claude/projects with one session log per cwd. */
function projects(cwds: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "claude-projects-"));
  dirs.push(root);
  for (const cwd of cwds) {
    const folder = join(root, cwd.replace(/\//g, "-"));
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "11111111-1111-4111-8111-111111111111.jsonl"),
      JSON.stringify({ type: "user", cwd, gitBranch: "main", message: { role: "user", content: "hello" } }) + "\n"
    );
  }
  return root;
}

describe("discoverClaude looks only where it is told", () => {
  it("probes and reports a session inside a named folder, and leaves one outside untouched", async () => {
    const vault = mkdtempSync(join(tmpdir(), "vault-"));
    const outside = mkdtempSync(join(tmpdir(), "desktop-"));
    dirs.push(vault, outside);
    const inVault = join(vault, "notes");
    mkdirSync(inVault);
    const root = projects([inVault, outside]);

    const { repos, sessions } = await discoverClaude({ within: [vault], projectsDir: root });

    expect(repos.map((r) => r.cwd)).toEqual([inVault]);
    expect(sessions.map((s) => s.repoCwd)).toEqual([inVault]);
    expect(touched.some((p) => p.startsWith(outside))).toBe(false);
    expect(touched.some((p) => p.startsWith(inVault))).toBe(true);
  });

  it("with no folders named, reads nothing — not even the session logs", async () => {
    const outside = mkdtempSync(join(tmpdir(), "desktop-"));
    dirs.push(outside);
    const root = projects([outside]);
    touched.length = 0;

    const { repos, sessions } = await discoverClaude({ within: [], projectsDir: root });

    expect(repos).toEqual([]);
    expect(sessions).toEqual([]);
    expect(touched.filter((p) => p !== root)).toEqual([]);
  });

  it("does not take a folder whose name merely starts with the named one", async () => {
    const base = mkdtempSync(join(tmpdir(), "vaults-"));
    dirs.push(base);
    const work = join(base, "Work");
    const workshop = join(base, "Workshop");
    mkdirSync(work);
    mkdirSync(workshop);
    const root = projects([work, workshop]);

    const { repos } = await discoverClaude({ within: [work], projectsDir: root });

    expect(repos.map((r) => r.cwd)).toEqual([work]);
    expect(touched.some((p) => p.startsWith(workshop))).toBe(false);
  });
});
