import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Writing generated files to disk, or checking that what is committed is what
// would be generated. One implementation for every generator in the repo —
// endpoint descriptions, route files — so "is it stale?" means the same thing
// for each, and a script and its test cannot disagree about it.

export interface GeneratedFile {
  /** Relative to the root it is written under. */
  file: string;
  source: string;
}

export interface GeneratedDrift {
  /** Files that are missing or differ from what would be generated. */
  changed: string[];
  /** Files on disk, under an owned directory, that nothing generates any more. */
  stale: string[];
}

function filesNamed(dir: string, name: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return filesNamed(p, name);
    return e.name === name ? [p] : [];
  });
}

/**
 * How the files under `root` differ from `files`.
 *
 * `owned` names directories (relative to `root`) in which every file called
 * `ownedName` is generated — so one left behind by a deleted definition is
 * reported, and removed on write.
 */
export function generatedDrift(
  root: string,
  files: readonly GeneratedFile[],
  owned: { dirs: readonly string[]; name: string } = { dirs: [], name: "" }
): GeneratedDrift {
  const wanted = new Set(files.map((f) => join(root, f.file)));
  const changed = files
    .filter((f) => {
      const abs = join(root, f.file);
      return !existsSync(abs) || readFileSync(abs, "utf8") !== f.source;
    })
    .map((f) => f.file);
  const stale = owned.dirs
    .flatMap((d) => filesNamed(join(root, d), owned.name))
    .filter((abs) => !wanted.has(abs))
    .map((abs) => abs.slice(root.length + 1));
  return { changed, stale };
}

/**
 * Write `files` under `root` (removing stale ones), or with `check` only
 * report. Returns true when nothing was, or needs to be, changed.
 */
export function syncGeneratedFiles(opts: {
  root: string;
  files: readonly GeneratedFile[];
  owned?: { dirs: readonly string[]; name: string };
  check: boolean;
  /** What is being generated, for the message: "api routes". */
  what: string;
  /** The command that regenerates, for the message. */
  fix: string;
}): boolean {
  const drift = generatedDrift(opts.root, opts.files, opts.owned);
  const clean = drift.changed.length === 0 && drift.stale.length === 0;
  if (opts.check) {
    if (clean) {
      console.log(`${opts.what}: up to date (${opts.files.length} file(s))`);
      return true;
    }
    console.error(
      `${opts.what}: out of date.\n` +
        [...drift.changed.map((f) => `  to write  ${f}`), ...drift.stale.map((f) => `  to remove ${f}`)].join("\n") +
        `\nRun: ${opts.fix}  — then commit.`
    );
    return false;
  }
  for (const f of drift.stale) rmSync(join(opts.root, f));
  const byFile = new Map(opts.files.map((f) => [f.file, f.source]));
  for (const f of drift.changed) {
    const abs = join(opts.root, f);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, byFile.get(f) ?? "");
  }
  console.log(`${opts.what}: wrote ${drift.changed.length}, removed ${drift.stale.length}, of ${opts.files.length} file(s)`);
  return clean;
}
