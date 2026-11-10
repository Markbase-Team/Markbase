import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The browser imports this package, and none of it may reach Node.
//
// The old version of this test lived in @ticketing/core and followed only
// RELATIVE imports. That left a hole: core's barrel re-exported
// vault-sync-manager, which imports @ticketing/docs, and nothing checked what
// came back through that edge. If a node builtin had ever become reachable via
// docs, the test would have passed anyway.
//
// So this walker follows @markbase/* specifiers too. It is also why the split
// exists at all: the boundary is now the package graph rather than a promise a
// barrel makes about itself, and the two modules that used to straddle it
// (crdt-supabase, vault-sync-manager) live in the packages that own them.

const PKGS = resolve(__dirname, "../../..");
const CORE = join(PKGS, "core");
const FEATURES = join(PKGS, "features");
const REPO = resolve(PKGS, "..");

/**
 * Published package name → its directory, across both groups.
 *
 * Scanned rather than listed, and keyed by the name an import specifier
 * actually says. The previous version carried two hand-kept arrays plus an
 * inline `m[1] === "node" ? "server"` fixup, because three directories
 * disagreed with the package they published. The reorg aligned every directory
 * with its name so the fixups are gone — scanning is what keeps them gone.
 */
const PKG_DIR: Record<string, string> = Object.fromEntries(
  [CORE, FEATURES].flatMap((group) =>
    readdirSync(group, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => [
        JSON.parse(readFileSync(join(group, e.name, "package.json"), "utf8"))
          .name as string,
        join(group, e.name),
      ])
  )
);

/** The package directory a workspace file belongs to: core/<x> and features/<x> both give <x>. */
const pkgOf = (file: string): string => file.slice(PKGS.length + 1).split("/")[1];

/** Resolve one import specifier to a file, or null if it leaves the workspace. */
function resolveSpec(fromFile: string, spec: string): string | null {
  const candidates: string[] = [];
  if (spec.startsWith(".")) {
    const base = resolve(dirname(fromFile), spec);
    candidates.push(`${base}.ts`, join(base, "index.ts"));
  } else if (spec.startsWith("@markbase/")) {
    const [scope, name, ...rest] = spec.split("/");
    const dir = PKG_DIR[`${scope}/${name}`];
    if (!dir) return null;
    const src = join(dir, "src");
    candidates.push(
      rest.length ? `${join(src, ...rest)}.ts` : join(src, "index.ts"),
      join(src, ...rest, "index.ts"),
      // A package whose logic layer has a name of its own — docs splits
      // logic/ from server/ and ui/, so its root export is src/logic/index.ts.
      rest.length ? `${join(src, "logic", ...rest)}.ts` : join(src, "logic", "index.ts"),
      join(src, "logic", ...rest, "index.ts")
    );
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Every workspace module reachable from an entry, across packages. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
      const next = resolveSpec(file, m[1]);
      if (next) queue.push(next);
    }
  }
  return [...seen];
}

const nodeDependents = (entry: string): string[] =>
  importGraph(entry)
    .filter((f) => /from\s+"node:|require\("node:/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(PKGS.length + 1))
    .sort();

/**
 * Which OTHER workspace packages an entry pulls in.
 *
 * Excluding the entry's own package, not a hardcoded name — the first version
 * filtered out "protocol" literally, so asking about docs reported ["docs"]
 * (itself) and silently dropped the real protocol edge it was meant to check.
 */
function packagesReached(entry: string): string[] {
  const own = pkgOf(entry);
  return [
    ...new Set(importGraph(entry).map(pkgOf).filter((p) => p !== own)),
  ].sort();
}

/**
 * Which packages are FEATURES — things a release may leave out.
 *
 * Read from the manifests under `packages/features/` rather than listed here: a
 * feature is exactly a package that declares itself in `markbase.json`, and two
 * lists of that would drift the first time someone added a feature and updated
 * only one of them.
 *
 * The vault is core: the memory layer, owning the container (which files exist,
 * what appears on disk). docs is a feature: it supplies what goes INSIDE a vault
 * file. ui and llm are shared capabilities rather than features — everything may
 * depend on them, and nothing ships without them.
 */
const FEATURE_PKG_DIRS = readdirSync(FEATURES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(FEATURES, e.name, "markbase.json")))
  .map((e) => e.name)
  .sort();

/** Node-only packages, by name — which is now also their directory. */
const NODE_PKGS = ["node", "vault", "runner"];

/** Every .ts/.tsx file under one package's src. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, acc);
    else if (/\.tsx?$/.test(p)) acc.push(p);
  }
  return acc;
}

/**
 * Direct feature-to-feature imports, as "a → b".
 *
 * Direct rather than transitive on purpose: the question this answers is "can a
 * release drop this package", and that is decided by who imports it, not by what
 * it reaches. A feature importing the kernel is fine and expected.
 */
function crossFeatureEdges(): string[] {
  const found: string[] = [];
  for (const dir of FEATURE_PKG_DIRS) {
    const declared = manifestOf(dir).requires ?? [];
    for (const f of sourceFiles(join(FEATURES, dir, "src"))) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/from\s+"@markbase\/([a-z-]+)/g)) {
        if (m[1] !== dir && FEATURE_PKG_DIRS.includes(m[1]) && !declared.includes(m[1])) {
          found.push(`${dir} → ${m[1]}`);
        }
      }
    }
  }
  return [...new Set(found)].sort();
}

/** A feature's manifest, parsed but not validated — the registry does that. */
function manifestOf(dir: string): { requires?: string[] } {
  return JSON.parse(readFileSync(join(FEATURES, dir, "markbase.json"), "utf8"));
}

/**
 * The feature-to-feature edges a manifest declares with `requires`, as
 * "a → b". The only imports `crossFeatureEdges` lets through, so they are
 * pinned here: a new one is a release decision, not a convenience.
 */
function declaredFeatureEdges(): string[] {
  return FEATURE_PKG_DIRS.flatMap((dir) =>
    (manifestOf(dir).requires ?? []).map((req) => `${dir} → ${req}`)
  ).sort();
}

/** Client components that reach a node-only package, as "file → package". */
function clientFilesImportingNodePackages(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(p)) continue;
      const text = readFileSync(p, "utf8");
      // The directive must be the first statement, so only the head matters.
      if (!/^\s*["']use client["']/.test(text)) continue;
      for (const m of text.matchAll(/from\s+"@markbase\/([a-z-]+)/g)) {
        if (NODE_PKGS.includes(m[1])) {
          found.push(`${p.slice(REPO.length + 1)} → @markbase/${m[1]}`);
        }
      }
    }
  };
  walk(join(REPO, "apps/web/src"));
  return [...new Set(found)].sort();
}

/**
 * Packages that import `next/*`, as "file → specifier".
 *
 * A package that imports `next/*` can only ever be rendered by a Next app, so
 * it cannot be reused by the Electron shell or anything else. This is the one
 * rule that decides whether a second shell is a new entry point or a rewrite.
 *
 * The packages are clean today. This pins it before the features move in from
 * `apps/web`, because a leak that arrives with a move is cheap to reject and
 * expensive to find six packages later.
 *
 * Narrow on purpose: `next/*` only. Touching a database, being a server module,
 * or rendering React are all fine — assuming a Next *runtime* is not.
 */
function packagesImportingNext(): string[] {
  const found: string[] = [];
  for (const dir of Object.values(PKG_DIR)) {
    for (const f of sourceFiles(join(dir, "src"))) {
      for (const m of readFileSync(f, "utf8").matchAll(
        /from\s+"(next(?:\/[a-z/-]+)?)"/g
      )) {
        found.push(`${f.slice(PKGS.length + 1)} → ${m[1]}`);
      }
    }
  }
  return [...new Set(found)].sort();
}

describe("package boundary", () => {
  it("protocol reaches no node builtins, even through another package", () => {
    expect(nodeDependents(join(CORE, "protocol/src/index.ts"))).toEqual([]);
  });

  // The cycle this split exists to break: docs imports protocol for the Supabase
  // client, so protocol must not import docs back. Nor may the isomorphic half
  // reach the node half — that is the whole point of separating them.
  it("protocol depends on no other workspace package", () => {
    expect(packagesReached(join(CORE, "protocol/src/index.ts"))).toEqual([]);
  });

  // docs is imported by the browser editor, so it carries the same obligation.
  it("docs reaches no node builtins", () => {
    expect(nodeDependents(join(FEATURES, "docs/src/logic/index.ts"))).toEqual([]);
  });

  it("docs depends on protocol only", () => {
    expect(packagesReached(join(FEATURES, "docs/src/logic/index.ts"))).toEqual([
      "protocol",
    ]);
  });

  // The node packages are allowed — expected — to reach builtins. These assert
  // the entries are real and wired, not that they are pure.
  it.each(NODE_PKGS)("packages/core/%s exists and does touch node", (dir) => {
    const entry = join(CORE, dir, "src/index.ts");
    expect(existsSync(entry)).toBe(true);
    expect(importGraph(entry).length).toBeGreaterThan(1);
  });

  // The package graph above keeps protocol clean, but nothing in it stops a
  // browser component importing @markbase/vault directly — which is how chokidar
  // and node:fs reach a client bundle. The plan asks for a lint rule; this is a
  // test instead, because ESLint conditions on paths and `"use client"` is a
  // string inside the file.
  it('no "use client" file imports a node-only package', () => {
    expect(clientFilesImportingNodePackages()).toEqual([]);
  });

  /**
   * Phase 1a: a feature a release may leave out must not be imported by another
   * feature. No plugin system rescues a feature that other features import.
   *
   * This was pinned at ["attention → email"] while that edge existed. The
   * unsubscribe slot removed it, so the set is empty and stays empty: every
   * feature package now builds with every other one deleted.
   */
  it("no feature imports another feature it has not declared", () => {
    expect(crossFeatureEdges()).toEqual([]);
  });

  /**
   * The one declared edge. attention's page is the boards beside the inbox,
   * and its sweep, clear and search reach Gmail through email's server layer;
   * when those left apps/web for the package, the composition went with them
   * and the manifest says so. `enabledFeatures` refuses a build that names
   * attention without email, so the edge never surprises a release.
   */
  it("declared requirements are exactly the ones a release has decided on", () => {
    expect(declaredFeatureEdges()).toEqual(["attention → email"]);
  });

  /**
   * Why chatJson moved here: a shared capability inside a feature package makes
   * that feature un-droppable. llm must stay a leaf, or every feature that wants
   * a model inherits whatever it grows.
   */
  it("llm depends on nothing", () => {
    expect(packagesReached(join(CORE, "llm/src/index.ts"))).toEqual([]);
  });
});

/**
 * Files under packages/ that read the desktop bridge off the window.
 *
 * The Electron shell exposes `window.markbase` to its pages. A feature that
 * reads it is pinned to one shell's global — and to the shape of that global,
 * which the preload now cuts per window. What a feature needs from its host it
 * asks for as a port (see @markbase/docs/ui/ports) and the shell hands in.
 */
function packagesReadingDesktopBridge(): string[] {
  const found: string[] = [];
  for (const base of [CORE, FEATURES]) {
    for (const pkg of readdirSync(base, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      for (const f of sourceFiles(join(base, pkg.name, "src"))) {
        if (!/\bwindow\.markbase\b/.test(readFileSync(f, "utf8"))) continue;
        found.push(f.slice(REPO.length + 1));
      }
    }
  }
  return found.sort();
}

describe("shell independence", () => {
  it("no package imports next/*", () => {
    expect(packagesImportingNext()).toEqual([]);
  });

  it("no package reads window.markbase", () => {
    expect(packagesReadingDesktopBridge()).toEqual([]);
  });
});

/**
 * Routes that mint credentials, and must therefore stay session-only.
 *
 * Every other route resolves its caller through the shared path, which accepts
 * a scoped API key as well as a browser session. These may not: a `write` key
 * issued for one purpose could otherwise mint a second key with any scopes it
 * liked, turning a narrow credential into a general one. Signing in is the only
 * way to create a key.
 */
const SESSION_ONLY = ["apps/web/src/app/api/admin/api-keys"];

function sessionOnlyRoutesUsingSharedAuth(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (e.name !== "route.ts") continue;
      if (/\bauthenticateAgent\b/.test(readFileSync(p, "utf8"))) {
        found.push(p.slice(REPO.length + 1));
      }
    }
  };
  for (const d of SESSION_ONLY) walk(join(REPO, d));
  return found.sort();
}

describe("credential minting", () => {
  // Not a style rule. Unifying this one alongside the other 61 would let a
  // leaked key escalate itself, and the change would look like tidying up.
  it("the api-keys routes accept a session and nothing else", () => {
    expect(sessionOnlyRoutesUsingSharedAuth()).toEqual([]);
  });

  // …and the guard above is only meaningful while those routes exist.
  it("the api-keys routes are still there to guard", () => {
    expect(existsSync(join(REPO, SESSION_ONLY[0], "route.ts"))).toBe(true);
  });
});

/**
 * Feature packages that spell out a shell's URLs, as "file:line".
 *
 * The navigation port took the framework out of these packages; this is the
 * other half. A component that builds "/dashboard/documents/<id>" still knows
 * the shell's URL scheme, so a desktop shell routing on different paths would
 * be silently wrong — the code compiles, renders, and navigates to nothing.
 *
 * Comments are exempt: describing where something is mounted is not a
 * dependency on it.
 */
function featuresSpellingOutUrls(): string[] {
  const found: string[] = [];
  for (const dir of FEATURE_PKG_DIRS) {
    for (const f of sourceFiles(join(FEATURES, dir, "src"))) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
          if (/["'`]\/dashboard\b/.test(code)) {
            found.push(`${f.slice(PKGS.length + 1)}:${i + 1}`);
          }
        });
    }
  }
  return found.sort();
}

describe("route ownership", () => {
  // The shell owns its URLs. A feature says "take me to this document" and is
  // handed back whatever that means here — see @markbase/docs/ui's DocsRouting.
  it("no feature package spells out a shell URL", () => {
    expect(featuresSpellingOutUrls()).toEqual([]);
  });
});

describe("the two groups", () => {
  /**
   * The reorg's own invariant. `packages/core/*` ships in every release;
   * `packages/features/*` is what a release may leave out. Anything under
   * features/ without a manifest is invisible to the build composer — it would
   * never reach `transpilePackages`, and the failure looks like a missing module
   * at build time rather than a missing manifest.
   */
  it("every package under features/ declares a manifest", () => {
    const dirs = readdirSync(FEATURES, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirs).toEqual(FEATURE_PKG_DIRS);
  });

  it("no package under core/ declares one", () => {
    const withManifest = readdirSync(CORE, { withFileTypes: true })
      .filter(
        (e) => e.isDirectory() && existsSync(join(CORE, e.name, "markbase.json"))
      )
      .map((e) => e.name);
    expect(withManifest).toEqual([]);
  });

  /**
   * Three directories used to disagree with the package they published
   * (agent-chat/@markbase/agent, server/@markbase/node, features/…). Every
   * lookup that crossed that gap needed a hand-written fixup, and each one was
   * a place to forget. The reorg closed it; this keeps it closed.
   */
  it("every directory is named after the package it publishes", () => {
    const mismatched = Object.entries(PKG_DIR)
      .filter(([name, dir]) => dir.split("/").pop() !== name.split("/")[1])
      .map(([name, dir]) => `${dir.slice(PKGS.length + 1)} publishes ${name}`);
    expect(mismatched).toEqual([]);
  });
});

describe("feature manifests", () => {
  // R4 makes a feature "a package with a markbase.json". This asserts the
  // definition has teeth: the set the boundary test guards is the same set the
  // build composes from, so a feature can never be droppable by one and not the
  // other.
  it("the known features are there, and no kernel package is", () => {
    expect(FEATURE_PKG_DIRS).toContain("docs");
    expect(FEATURE_PKG_DIRS).toContain("attention");
    for (const kernel of [
      "protocol", "ui", "llm", "node", "vault", "runner", "registry",
      // Demoted from features deliberately: every release ships them.
      // agent is the agent rail, browser-agent the fallback for systems with
      // no connector, flows the Operator seam both node hosts sit on.
      "agent", "browser-agent", "flows",
    ]) {
      expect(FEATURE_PKG_DIRS).not.toContain(kernel);
    }
  });

  it("each manifest's pkg matches its package.json name", () => {
    for (const dir of FEATURE_PKG_DIRS) {
      const manifest = JSON.parse(
        readFileSync(join(FEATURES, dir, "markbase.json"), "utf8")
      );
      const pkg = JSON.parse(
        readFileSync(join(FEATURES, dir, "package.json"), "utf8")
      );
      expect(manifest.pkg).toBe(pkg.name);
    }
  });
});
