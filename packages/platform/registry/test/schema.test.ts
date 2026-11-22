import { describe, it, expect } from "vitest";
import { FeatureManifest, featureJsonSchema } from "../src/schema";

const valid = {
  id: "docs",
  pkg: "@markbase/docs",
  summary: "Documents.",
};

describe("feature manifest schema", () => {
  it("accepts a minimal manifest and defaults the optional arrays", () => {
    const r = FeatureManifest.parse(valid);
    expect(r.sidebar).toEqual([]);
    expect(r.centre).toEqual([]);
  });

  // `.strict()` earns its keep here: a manifest is hand-written JSON with no
  // type checker behind it, so a typo'd key would otherwise be accepted and
  // silently do nothing — the feature simply would not contribute what its
  // author believed it had declared.
  it("rejects an unknown top-level key rather than ignoring it", () => {
    expect(() => FeatureManifest.parse({ ...valid, crons: [] })).toThrow();
    expect(() => FeatureManifest.parse({ ...valid, sidbar: [] })).toThrow();
  });

  it("constrains the id to lowercase kebab-case", () => {
    for (const id of ["Docs", "docs_x", "1docs", "", "docs.x"]) {
      expect(() => FeatureManifest.parse({ ...valid, id })).toThrow();
    }
    expect(FeatureManifest.parse({ ...valid, id: "browser-agent" }).id).toBe(
      "browser-agent"
    );
  });

  it("requires pkg to be a @markbase package", () => {
    for (const pkg of ["docs", "@other/docs", "@markbase/Docs"]) {
      expect(() => FeatureManifest.parse({ ...valid, pkg })).toThrow();
    }
  });

  describe("sidebar entries", () => {
    const entry = {
      id: "documents",
      title: "Documents",
      href: "/dashboard/documents",
      icon: "FileText",
    };
    const withSidebar = (e: unknown) =>
      FeatureManifest.parse({ ...valid, sidebar: [e] });

    it("requires title, and an absolute href", () => {
      expect(() => withSidebar({ ...entry, title: "" })).toThrow();
      expect(() => withSidebar({ ...entry, href: "dashboard" })).toThrow();
      const { title: _t, ...noTitle } = entry;
      expect(() => withSidebar(noTitle)).toThrow();
    });

    // The icon is a lucide export NAME, because JSON cannot hold a component.
    // The shape is checked here; that the name actually resolves is checked in
    // the sidebar's own test, which can import lucide.
    it("requires the icon to look like a lucide export", () => {
      for (const icon of ["fileText", "file-text", ""]) {
        expect(() => withSidebar({ ...entry, icon })).toThrow();
      }
    });
  });

  it("emits a JSON Schema for editors", () => {
    const s = featureJsonSchema() as Record<string, unknown>;
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties as object)).toContain("sidebar");
  });
});

describe("contributes.app", () => {
  const withApp = (app: unknown[]) =>
    FeatureManifest.parse({ ...valid, contributes: { app } });

  it("accepts a route file path under app/, with or without segment config", () => {
    const r = withApp([
      "dashboard/terms/page",
      "api/v1/terms/[id]/ask/route",
      "dashboard/projects/[slug]/layout",
      { path: "api/cron/sweep/route", maxDuration: 300 },
      { path: "projects/[project]/page", dynamic: "force-dynamic", title: "Project" },
    ]);
    expect(r.contributes.app).toHaveLength(5);
  });

  // The generator decides where in the app tree a stub lands, so a path that
  // names a group, climbs out, or is not a route file at all is a mistake in
  // the manifest rather than something to silently place.
  it("rejects anything that is not a plain route file path", () => {
    for (const path of [
      "/dashboard/terms/page",
      "dashboard/terms",
      "dashboard/terms/page.tsx",
      "../lib/x/route",
      "(group)/x/page",
      "dashboard/Terms/page",
      "api/v1/[id]/route/",
    ]) {
      expect(() => withApp([path]), path).toThrow();
    }
    expect(() => withApp([{ path: "api/x/route", maxDuration: 0 }])).toThrow();
    expect(() => withApp([{ path: "api/x/route", runtime: "edge" }])).toThrow();
  });

  // `contributes` is partial, so an absent list reads as undefined there;
  // the generator treats that as nothing contributed.
  it("defaults to nothing contributed and nothing required", () => {
    expect(FeatureManifest.parse(valid).contributes.app ?? []).toEqual([]);
    expect(FeatureManifest.parse(valid).requires).toEqual([]);
  });

  it("constrains requires to feature ids", () => {
    expect(FeatureManifest.parse({ ...valid, requires: ["email"] }).requires).toEqual(["email"]);
    expect(() => FeatureManifest.parse({ ...valid, requires: ["@markbase/email"] })).toThrow();
  });
});
