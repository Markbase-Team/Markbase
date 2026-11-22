// What a vault does not sync — `.markbaseignore`, at the vault root.
//
// This was a constant in the code: a fixed set of directory names (node_modules,
// dist, build, …) that every vault skipped and no user could change. The set was
// added because pointing a vault at a code repo walked into node_modules and
// adopted 735 dependency READMEs as documents — but a hard-coded list only ever
// answers for the repositories we thought of. A vault with a `datasets/` folder
// of generated markdown, or a `Pods/` we never listed, had no way to say so.
//
// So the rules become a file that travels with the folder, seeded with those
// defaults on first mount. Editing it is how you change what your vault holds,
// and the file being IN the vault means the answer moves with it between
// machines.
//
// Deliberately a small language, not gitignore. Every pattern here answers "is
// this path mine?", and the shapes below are the ones that question needs; a
// half-implemented gitignore that silently mis-handles `!` negation or `**`
// would be worse than a small one that does what it says.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The file, at the vault root, named the way every other ignore file is.
 *
 * It briefly lived in `.markbase/` beside the vault marker, which is tidier and
 * wrong: that folder holds what MARKBASE needs to know, and this is the one file
 * here we actively want the user to edit. Two levels down inside a hidden
 * directory is where you put something people should leave alone.
 *
 * `.gitignore`, `.npmignore`, `.dockerignore` — a developer opening a repo knows
 * what `.markbaseignore` is without being told, and it sits where they will look
 * for it. The leading dot keeps it out of a notes vault's file list, where a
 * plain `markbaseignore` would sit among someone's writing looking like a
 * mistake.
 */
export const IGNORE_FILE = ".markbaseignore";

/**
 * What a new vault starts with — the old GENERATED_DIRS, verbatim, plus the
 * comments explaining why each group is there. A user who opens the file should
 * be able to tell what it is for and edit it with confidence.
 */
export const DEFAULT_IGNORE = `# What this vault does not sync.
#
# One pattern per line. A bare name matches a file or folder of that name at any
# depth; a leading "/" anchors it to the vault root; a trailing "/" matches only
# directories; "*" matches within one path segment. Lines starting with "#" are
# comments.
#
# Edit freely — this file lives in the vault and travels with it.

# Dependency trees. A package manager's, not yours: nobody writes notes in
# node_modules, and a vault that syncs one is a mirror of somebody's lockfile.
node_modules/
vendor/
__pycache__/
site-packages/
Pods/
bower_components/

# Build output — derived from files you DO own, so syncing it stores the same
# words twice and the copy goes stale the moment the source changes.
dist/
build/
out/
target/
`;

interface Rule {
  /** Matched against a single path segment, or the whole path when anchored. */
  test: (value: string) => boolean;
  /** Only match a path that starts here, rather than a segment at any depth. */
  anchored: boolean;
  /** Only match directories — a trailing "/" in the pattern. */
  dirOnly: boolean;
}

/** Compiled rules for one vault. */
export interface VaultIgnore {
  /** Should this vault-relative path be left alone? */
  ignores: (relPath: string, isDir?: boolean) => boolean;
  /** How many patterns are in force — for logging a vault's setup. */
  size: number;
}

function globToRegExp(pattern: string): RegExp {
  // "*" stops at a separator, so `docs/*.md` cannot swallow `docs/a/b.md`.
  const source = pattern
    .split("")
    .map((ch) => {
      if (ch === "*") return "[^/]*";
      if (ch === "?") return "[^/]";
      return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
    })
    .join("");
  return new RegExp(`^${source}$`);
}

function compile(line: string): Rule | null {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) return null;

  const dirOnly = pattern.endsWith("/");
  if (dirOnly) pattern = pattern.slice(0, -1);
  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);
  // An interior slash is a path, so it can only mean "from the root" —
  // `docs/build` cannot sensibly match a segment.
  const isPath = pattern.includes("/");
  if (!pattern) return null;

  // Compile the pattern ONCE, here, not on every path tested against it. Built
  // inside the matcher it was rebuilt per comparison — 20,000 paths against four
  // glob rules cost 100ms of nothing but re-parsing the same four patterns.
  const glob = /[*?]/.test(pattern) ? globToRegExp(pattern) : null;
  const matcher = glob
    ? (value: string) => glob.test(value)
    : (value: string) => value === pattern;
  return { test: matcher, anchored: anchored || isPath, dirOnly };
}

/** Compile ignore rules from the file's text. */
export function parseIgnore(text: string): VaultIgnore {
  const rules = text.split(/\r?\n/).map(compile).filter((r): r is Rule => r !== null);
  const ignores = (relPath: string, isDir = false): boolean => {
    const path = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path) return false;
    const segments = path.split("/").filter((s) => s !== "" && s !== ".");
    for (const rule of rules) {
      if (rule.anchored) {
        // Anchored rules match the path from the root, and everything under it:
        // `/build` hides `build/x/y.md` too, not just `build` itself.
        if (rule.test(path)) return true;
        for (let i = 1; i < segments.length; i++) {
          if (rule.test(segments.slice(0, i).join("/"))) return true;
        }
        continue;
      }
      // A bare name matches a segment at any depth. `dirOnly` still holds for
      // the LAST segment only — an interior segment is by definition a
      // directory, which is what makes `node_modules/` hide everything inside.
      for (let i = 0; i < segments.length; i++) {
        const last = i === segments.length - 1;
        if (rule.dirOnly && last && !isDir) continue;
        if (rule.test(segments[i])) return true;
      }
    }
    return false;
  };
  return { ignores, size: rules.length };
}

/** Rules with nothing ignored — for callers that have no vault folder. */
export function emptyIgnore(): VaultIgnore {
  return { ignores: () => false, size: 0 };
}

/**
 * Read a vault's rules, writing the defaults if the file isn't there yet.
 *
 * Seeding on read rather than at mount time means a vault that predates this
 * file gets one the first time it syncs, and a user who deletes the file gets
 * the defaults back rather than a vault that suddenly syncs node_modules.
 */
export function loadVaultIgnore(vaultDir: string): VaultIgnore {
  const path = join(vaultDir, IGNORE_FILE);
  try {
    if (!existsSync(path)) {
      writeFileSync(path, DEFAULT_IGNORE);
      return parseIgnore(DEFAULT_IGNORE);
    }
    return parseIgnore(readFileSync(path, "utf8"));
  } catch {
    // An unreadable or unwritable folder must not mean "sync everything" — that
    // is the failure that fills a vault with a dependency tree.
    return parseIgnore(DEFAULT_IGNORE);
  }
}
