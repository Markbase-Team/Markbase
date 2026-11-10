import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { FeatureManifest } from "./schema";

// Build-time only. This reads the filesystem, so it must never be imported by
// anything that reaches a browser bundle — `next.config.ts`, tests and codegen
// scripts are the callers.

/**
 * The repository root — the directory holding `packages/`.
 *
 * Walks up from the current directory rather than resolving against
 * `import.meta.url`: a bundler reads `new URL("../..", import.meta.url)` as a
 * module specifier and fails the build trying to resolve it. This is build-time
 * code, so the process always starts inside the repo.
 */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "packages"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find a repo root above ${process.cwd()}`);
}

export interface LoadedFeature {
  manifest: FeatureManifest;
  /** Absolute path of the manifest, for error messages. */
  file: string;
  /** Package directory name when the feature owns one, else undefined. */
  dir?: string;
}

/** Parse and validate one manifest file. */
function readManifest(file: string): FeatureManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: not valid JSON — ${(e as Error).message}`);
  }
  const parsed = FeatureManifest.safeParse(raw);
  // Name the file. A schema error with no path is a scavenger hunt.
  if (!parsed.success) {
    throw new Error(`${file}: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }
  return parsed.data;
}

/**
 * Every feature manifest in the repo, from both places one can live.
 *
 * A feature is **a manifest**, not a package. Two locations, one schema:
 *
 * - `packages/features/<name>/markbase.json` — a feature that owns a package.
 *   Colocated with its code, and exactly the shape a third-party plugin ships.
 *   `packages/core/*` is deliberately not scanned: the kernel ships in every
 *   release, so there is nothing for a manifest to decide.
 * - `features/<id>.json` — a feature whose code still sits in `apps/web`. Most
 *   of them: the reader, terms, the diary, skills, agents, today, the board.
 *
 * When one of those grows a package later, its manifest moves into it and gains
 * a `pkg` field. Nothing else changes — which is the point of not letting
 * package-ownership decide what counts as a feature.
 *
 * Sorted by id so generated output is stable: an unsorted scan makes
 * `transpilePackages` reorder between machines and turns a no-op regeneration
 * into a diff.
 */
export function loadFeatures(root = repoRoot()): LoadedFeature[] {
  const out: LoadedFeature[] = [];

  const pkgsRoot = join(root, "packages", "features");
  if (existsSync(pkgsRoot)) {
    for (const entry of readdirSync(pkgsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(pkgsRoot, entry.name, "markbase.json");
      if (!existsSync(file)) continue;
      const manifest = readManifest(file);

      // A manifest disagreeing with its own package.json would generate a
      // transpilePackages entry for a package that does not exist, while the
      // real one went uncompiled.
      const pkgJson = join(pkgsRoot, entry.name, "package.json");
      if (manifest.pkg && existsSync(pkgJson)) {
        const name = JSON.parse(readFileSync(pkgJson, "utf8")).name;
        if (name !== manifest.pkg) {
          throw new Error(
            `${file}: declares pkg "${manifest.pkg}" but ${entry.name}/package.json is "${name}"`
          );
        }
      }
      out.push({ manifest, file, dir: entry.name });
    }
  }

  const appRoot = join(root, "features");
  if (existsSync(appRoot)) {
    for (const entry of readdirSync(appRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = join(appRoot, entry.name);
      const manifest = readManifest(file);
      // The filename is the id. Two names for one thing drift.
      const expected = `${manifest.id}.json`;
      if (entry.name !== expected) {
        throw new Error(`${file}: declares id "${manifest.id}", so it must be named ${expected}`);
      }
      out.push({ manifest, file });
    }
  }

  const ids = out.map((f) => f.manifest.id);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupe) throw new Error(`Duplicate feature id: ${dupe}`);

  return out.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

/**
 * What a build ships unless told otherwise: the released product. Everything
 * else in packages/features exists in the repository but is not released,
 * and a build gets it only by naming it.
 */
export const RELEASED_FEATURES = ["docs"] as const;

/**
 * Which features this build includes.
 *
 * `MARKBASE_FEATURES` unset or empty means the released set
 * (`RELEASED_FEATURES`): whether a feature is in a build is a release
 * decision, and the default is the one that has been made. `all` means every
 * feature in the repository; otherwise a comma-separated list of ids.
 *
 * An unrecognised id throws. Silently matching nothing is how you ship a build
 * that is missing a feature you believed was in it.
 */
export function enabledFeatures(
  all: LoadedFeature[],
  spec: string | undefined = process.env.MARKBASE_FEATURES
): LoadedFeature[] {
  const trimmed = spec?.trim() ?? "";
  if (trimmed === "all") return all;

  const wanted =
    trimmed === ""
      ? [...RELEASED_FEATURES]
      : trimmed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  const known = new Set(all.map((f) => f.manifest.id));
  const unknown = wanted.filter((id) => !known.has(id));
  if (unknown.length) {
    throw new Error(
      `MARKBASE_FEATURES names unknown feature(s): ${unknown.join(", ")}. ` +
        `Known: ${[...known].sort().join(", ")}`
    );
  }

  const keep = new Set(wanted);
  const enabled = all.filter((f) => keep.has(f.manifest.id));
  assertRequirements(enabled);
  return enabled;
}

/**
 * A feature that `requires` another is only in a build that has both.
 *
 * Refuses rather than adding the dependency silently: a build gets a feature
 * by naming it, and a feature appearing in a build nobody named it for is
 * the surprise `enabledFeatures` exists to rule out. The message names the
 * fix.
 */
function assertRequirements(enabled: LoadedFeature[]): void {
  const on = new Set(enabled.map((f) => f.manifest.id));
  for (const f of enabled) {
    const missing = f.manifest.requires.filter((id) => !on.has(id));
    if (missing.length) {
      throw new Error(
        `Feature "${f.manifest.id}" requires ${missing.join(", ")}: ` +
          `add it to MARKBASE_FEATURES or drop "${f.manifest.id}".`
      );
    }
  }
}
