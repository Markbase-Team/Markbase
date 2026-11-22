import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectBranches } from "@markbase/shared/worker-refresh";

const exec = promisify(execFile);

export function desktopDir(): string {
  return path.join(os.homedir(), "Desktop");
}

// Last path segment of a repo URL, used as the clone directory name.
export function repoNameFromUrl(url: string): string {
  const clean = url
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .replace(/:/g, "/");
  return clean.split("/").filter(Boolean).pop() || "repo";
}

// List the branches of a local repo so a ticket can pick which one to base
// work on. Merges local heads and origin remotes (de-duped, origin/ stripped).
export async function listBranches(localPath: string): Promise<ProjectBranches> {
  const git = (args: string[]) =>
    exec("git", ["-C", localPath, ...args], { timeout: 10_000 }).then((r) =>
      r.stdout.trim()
    );

  let current: string | null = null;
  try {
    current = (await git(["rev-parse", "--abbrev-ref", "HEAD"])) || null;
    if (current === "HEAD") current = null; // detached
  } catch {
    // not a repo / unreadable
  }

  let def: string | null = null;
  try {
    const head = await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    def = head.replace(/^origin\//, "") || null;
  } catch {
    // no origin/HEAD
  }

  const names = new Set<string>();
  try {
    const out = await git([
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes",
    ]);
    for (const raw of out.split("\n")) {
      const line = raw.trim();
      if (!line || line.endsWith("/HEAD")) continue;
      names.add(line.replace(/^origin\//, ""));
    }
  } catch {
    // ignore — return whatever we have
  }

  // Order: default, then current, then the rest alphabetically.
  const rest = [...names]
    .filter((b) => b !== def && b !== current)
    .sort((a, b) => a.localeCompare(b));
  const ordered = [def, current, ...rest].filter(
    (b): b is string => !!b && (names.has(b) || b === def || b === current)
  );
  const seen = new Set<string>();
  const branches = ordered.filter((b) => (seen.has(b) ? false : seen.add(b)));

  return { branches, default: def, current };
}

// Read the origin remote of a local repo, if any.
export async function getRemoteOrigin(localPath: string): Promise<string | null> {
  try {
    const { stdout } = await exec(
      "git",
      ["-C", localPath, "config", "--get", "remote.origin.url"],
      { timeout: 10_000 }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// Clone a remote repo into ~/Desktop and return the local path.
// Reuses an existing clone if the destination already holds a git repo.
export async function cloneToDesktop(remoteUrl: string): Promise<string> {
  const dest = path.join(desktopDir(), repoNameFromUrl(remoteUrl));

  if (existsSync(dest)) {
    if (existsSync(path.join(dest, ".git"))) return dest; // already cloned
    throw new Error(`A non-git folder already exists at ${dest}`);
  }

  // execFile (no shell) — remoteUrl is passed as an argument, not interpolated.
  await exec("git", ["clone", remoteUrl, dest], { timeout: 180_000 });
  return dest;
}
