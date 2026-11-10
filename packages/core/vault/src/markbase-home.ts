// Where this machine keeps what it knows about Markbase.
//
//   ~/.markbaseConfig/
//   ├── config.json   the mount registry — which vaults are folders here
//   ├── locks/        one syncing process per vault
//   └── vaults/       per-vault sync bases (three-way merge)
//
// One directory, shared by every Markbase process on the machine. That sharing
// is the point, not an accident: the desktop app and the CLI must agree on which
// vaults are mounted (or a vault mounted in one is invisible to the other, which
// is how it was before the registries merged), on who holds a vault's lock (or
// two daemons write one file), and on the sync base (or a handover between them
// three-way merges against nothing and discards offline edits).
//
// It moved here from ~/.config/markbase. That directory is the XDG convention and
// there was nothing wrong with it, but the nesting bought a level nobody read as
// meaningful — "the markbase folder inside the config folder" — and this is a
// path people end up typing when something has gone wrong.
//
// The move carries real risk, which is why `migrateHome` exists rather than a
// changed constant: the registry going missing means every vault silently reads
// as unmounted (it happened once, and a vault stayed lost for five days), and a
// missing sync base means the next merge has no idea what both sides last agreed
// on and can drop work done offline.

import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where everything lives now.
 *
 * `MARKBASE_HOME` overrides it. That is not only for tests: a development build
 * and an installed one otherwise share this directory, so running both means two
 * processes competing over one registry and one set of locks — which is exactly
 * what you do NOT want while changing how any of it works.
 */
export function markbaseHome(): string {
  return process.env.MARKBASE_HOME || join(homedir(), ".markbaseConfig");
}

/** Where it lived before — read once, to move it. */
export function legacyMarkbaseHome(): string {
  return process.env.MARKBASE_LEGACY_HOME || join(homedir(), ".config", "markbase");
}

export function registryPath(): string {
  return join(markbaseHome(), "config.json");
}

export function locksDir(): string {
  return join(markbaseHome(), "locks");
}

export function baseStoreDir(): string {
  return join(markbaseHome(), "vaults");
}

/**
 * Move `from`'s contents into `to`, merging directories rather than skipping
 * them.
 *
 * "Destination exists, leave it" is right for a FILE — whatever is there was
 * written after the move began and is newer. Applied to a directory it is a
 * quiet disaster: an empty `locks/` at the destination, created by any process
 * that touched the path first, makes this step over the real locks and sync
 * bases and leave them behind, while reporting success. That is not
 * hypothetical — an empty `locks/` and `vaults/` were sitting there the first
 * time this ran for real.
 */
function moveInto(from: string, to: string, moved: string[], prefix = ""): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dest = join(to, name);
    const label = prefix ? `${prefix}/${name}` : name;
    if (!existsSync(dest)) {
      renameSync(src, dest);
      moved.push(label);
      continue;
    }
    // Both directories: merge, so a partly-created destination cannot strand
    // what is still in the source.
    if (statSync(src).isDirectory() && statSync(dest).isDirectory()) {
      moveInto(src, dest, moved, label);
      continue;
    }
    // A file already at the destination is newer. Leave both alone.
  }
}

function entryCount(dir: string): number {
  try {
    return statSync(dir).isDirectory() ? readdirSync(dir).length : 0;
  } catch {
    return 0;
  }
}

/**
 * Move the old directory to the new one, once, on the first process that looks.
 *
 * Entry by entry rather than renaming the directory itself: a partly-created new
 * home (one process got here first, or an earlier attempt died) must not make
 * this give up and leave the rest behind. Anything already at the destination
 * wins — it is newer by definition, having been written after the move began.
 *
 * Never destructive. A failure at any point leaves the source where it is, and
 * `migrated` comes back false so the caller can say so rather than proceed on
 * the assumption that a registry it never moved is now in place.
 */
export function migrateHome(): { migrated: boolean; moved: string[]; error?: string } {
  const to = markbaseHome();
  const from = legacyMarkbaseHome();
  const moved: string[] = [];
  if (!existsSync(from)) return { migrated: false, moved };

  try {
    moveInto(from, to, moved);
  } catch (e) {
    return { migrated: false, moved, error: e instanceof Error ? e.message : String(e) };
  }

  // Say what arrived. A registry that moved but landed empty is the failure worth
  // catching, and counting is the cheapest way to notice it.
  if (moved.length > 0) {
    const summary = [
      existsSync(registryPath()) ? "registry" : null,
      entryCount(locksDir()) > 0 ? `${entryCount(locksDir())} lock(s)` : null,
      entryCount(baseStoreDir()) > 0 ? `${entryCount(baseStoreDir())} sync base(s)` : null,
    ].filter(Boolean);
    return { migrated: true, moved: summary as string[] };
  }
  return { migrated: false, moved };
}
