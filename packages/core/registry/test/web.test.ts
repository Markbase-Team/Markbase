import { describe, it, expect } from "vitest";
import {
  transpilePackages,
  KERNEL_PACKAGES,
  sidebarSlotsModule,
  appRouteStubs,
  APP_ROUTE_GROUP_DIRS,
} from "../src/web";
import type { LoadedFeature } from "../src/load";
import { loadFeatures, enabledFeatures, repoRoot } from "../src/load";

/**
 * What `next.config.ts` hardcoded before this change. Pinned here so the
 * generation is provably a refactor: if the generated list drifts from it,
 * something is being added or dropped from the build and the diff has to say
 * so out loud.
 */
const HARDCODED_BEFORE = [
  "@markbase/agent",
  "@markbase/llm",
  "@markbase/protocol",
  "@markbase/node",
  "@markbase/vault",
  "@markbase/docs",
  "@markbase/email",
  "@markbase/attention",
  "@markbase/browser-agent",
  "@markbase/ui",
].sort();

describe("transpilePackages", () => {
  const all = loadFeatures(repoRoot());

  /**
   * Every addition since the list was hand-maintained, and why each one is
   * correct rather than a mistake.
   *
   * The assertion is the point, not the contents: a package appearing here
   * without a line explaining it means the build started compiling something
   * nobody decided to compile. Add to this list only alongside the reason.
   */
  const ADDED_SINCE_HARDCODED = [
    // Kernel — the Operator seam both node hosts sit on. It was missing from
    // the hand-maintained list only because nothing in the web app imports it
    // yet. Next transpiles a listed package only when something reaches it, so
    // naming it costs nothing and stops the list going stale the day the app
    // does import it. That is the whole point of generating it.
    "@markbase/flows",
    // These three became packages: each one's UI left apps/web and its data
    // layer left packages/core/protocol, so the web build now has a workspace
    // package to compile where before it had app-local files. protocol no
    // longer carries a droppable feature's schema for any of them.
    "@markbase/reader",
    "@markbase/terms",
    "@markbase/diary",
    // Today had no data layer of its own to reclaim — its whole 453-line
    // surface was the page component. The page is now a three-line shell.
    "@markbase/today",
    // The board, the tickets surface and the public request form, plus the
    // sidebar section the shell used to render behind `entry.id === "projects"`.
    "@markbase/projects",
    // The last two. With these the repo-root features/ directory is gone: every
    // feature is a package, so `pkg` is set on every manifest and the generated
    // list is now simply "the kernel plus what shipped".
    "@markbase/skills",
    "@markbase/agents",
  ].sort();

  it("differs from the hand-maintained list only by packages we can account for", () => {
    const generated = transpilePackages(all);
    expect(generated).toEqual(
      [...HARDCODED_BEFORE, ...ADDED_SINCE_HARDCODED].sort()
    );

    const added = generated.filter((p) => !HARDCODED_BEFORE.includes(p));
    expect(added).toEqual(ADDED_SINCE_HARDCODED);
  });

  it("is sorted and free of duplicates", () => {
    const generated = transpilePackages(all);
    expect(generated).toEqual([...generated].sort());
    expect(new Set(generated).size).toBe(generated.length);
  });

  it("always keeps the kernel, whatever the feature set", () => {
    const only = enabledFeatures(all, "docs");
    const generated = transpilePackages(only);
    for (const k of KERNEL_PACKAGES) expect(generated).toContain(k);
    expect(generated).toContain("@markbase/docs");
    expect(generated).not.toContain("@markbase/attention");
  });

  it("drops a disabled feature's package", () => {
    const withoutAttention = enabledFeatures(
      all,
      all
        .map((f) => f.manifest.id)
        .filter((id) => id !== "attention")
        .join(",")
    );
    expect(transpilePackages(withoutAttention)).not.toContain(
      "@markbase/attention"
    );
  });
});

describe("sidebarSlotsModule", () => {
  const all = loadFeatures(repoRoot());

  it("imports the contributed slot for a shipped feature", () => {
    const src = sidebarSlotsModule(all);
    expect(src).toContain('from "@markbase/projects/ui/sidebar"');
    expect(src).toContain('"projects":');
  });

  /**
   * The property the whole generator exists for. A committed map that imported
   * every feature would pull a dropped feature's code back into the bundle —
   * and the build would still succeed, so nothing would say so.
   */
  it("imports nothing from a feature this build left out", () => {
    const src = sidebarSlotsModule(enabledFeatures(all, "docs"));
    expect(src).not.toContain("@markbase/projects");
    expect(src.match(/^import Slot/gm)).toBeNull();
    expect(src.match(/^import Provider/gm)).toBeNull();
  });

  // A feature whose code still lives in apps/web has no subpath to import.
  it("skips a feature with no package", () => {
    const src = sidebarSlotsModule(all);
    for (const f of all.filter((x) => !x.manifest.pkg)) {
      expect(src).not.toContain(`"${f.manifest.id}":`);
    }
  });
});

describe("appRouteStubs", () => {
  const all = loadFeatures(repoRoot());

  const feature = (
    id: string,
    app: LoadedFeature["manifest"]["contributes"]["app"]
  ): LoadedFeature => ({
    file: `${id}/markbase.json`,
    dir: id,
    manifest: {
      id,
      pkg: `@markbase/${id}`,
      summary: `${id}.`,
      sidebar: [],
      routes: [],
      centre: [],
      requires: [],
      contributes: { providers: [], app },
    },
  });

  it("writes a route stub that re-exports the package module and carries the config", () => {
    const [cron, plain] = appRouteStubs([
      feature("x", [
        { path: "api/cron/sweep/route", maxDuration: 300 },
        "api/v1/x/[id]/route",
      ]),
    ]);
    expect(cron.file).toBe("(features)/api/cron/sweep/route.ts");
    expect(cron.source).toContain('export * from "@markbase/x/app/api/cron/sweep/route";');
    expect(cron.source).toContain('export const runtime = "nodejs";');
    expect(cron.source).toContain("export const maxDuration = 300;");
    expect(plain.file).toBe("(features)/api/v1/x/[id]/route.ts");
    expect(plain.source).not.toContain("maxDuration");
  });

  // Under the dashboard the stub must sit inside the dashboard segment, or the
  // dashboard layout (sidebar, providers) would not wrap it.
  it("puts a dashboard page under the dashboard's group and hands it the host", () => {
    const [page, layout] = appRouteStubs([
      feature("x", [
        { path: "dashboard/x/page", title: "X!" },
        "dashboard/x/[slug]/layout",
      ]),
    ]);
    expect(page.file).toBe("dashboard/(features)/x/page.tsx");
    expect(page.source).toContain('from "@markbase/x/app/dashboard/x/page"');
    expect(page.source).toContain('from "@/lib/page-host"');
    expect(page.source).toContain("host={pageHost}");
    expect(page.source).toContain('export const metadata = { title: "X!" };');
    expect(layout.file).toBe("dashboard/(features)/x/[slug]/layout.tsx");
    expect(layout.source).toContain("export default function FeatureLayout");
  });

  it("writes only into the two generated groups", () => {
    for (const stub of appRouteStubs(all)) {
      expect(
        APP_ROUTE_GROUP_DIRS.some((d) => stub.file.startsWith(`${d}/`)),
        stub.file
      ).toBe(true);
    }
  });

  it("refuses two features contributing one route file", () => {
    expect(() =>
      appRouteStubs([feature("a", ["dashboard/x/page"]), feature("b", ["dashboard/x/page"])])
    ).toThrow(/already contributed by feature "a"/);
  });

  /**
   * The property the generator exists for, same as the slot map: nothing a
   * dropped feature owns is named anywhere in the app.
   */
  it("writes nothing for a feature this build left out", () => {
    const docsOnly = appRouteStubs(enabledFeatures(all, "docs"));
    expect(docsOnly).toEqual([]);
    const sources = appRouteStubs(all).map((s) => s.source).join("\n");
    expect(sources).toContain("@markbase/terms/app/");
  });
});
