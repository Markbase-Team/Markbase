import { describe, it, expect } from "vitest";
import {
  parseFeatures,
  visibleSidebar,
  featureEnabled,
  isDisabledRoute,
  parseDisabledRoutes,
  type FeatureRuntime,
} from "../src/runtime";
import { featuresEnvValue, disabledRoutesEnvValue } from "../src/web";
import { loadFeatures, enabledFeatures, repoRoot } from "../src/load";

const entry = (id: string) => ({
  id,
  title: id,
  href: `/dashboard/${id}`,
  icon: "FileText",
});

describe("parseFeatures", () => {
  // This runs while rendering the dashboard shell. A sidebar missing its
  // feature entries is a far better failure than a page that will not render,
  // and a genuinely wrong feature set is caught at build time instead.
  it("degrades to empty rather than throwing", () => {
    expect(parseFeatures(undefined)).toEqual([]);
    expect(parseFeatures("")).toEqual([]);
    expect(parseFeatures("{ not json")).toEqual([]);
    expect(parseFeatures('{"id":"docs"}')).toEqual([]); // object, not array
  });

  it("round-trips what the build inlines", () => {
    const all = loadFeatures(repoRoot());
    const parsed = parseFeatures(featuresEnvValue(all));
    expect(parsed.map((f) => f.id)).toEqual(all.map((f) => f.manifest.id));
  });

  it("carries only id and sidebar across, not the whole manifest", () => {
    const all = loadFeatures(repoRoot());
    const raw = JSON.parse(featuresEnvValue(all)) as Record<string, unknown>[];
    expect(Object.keys(raw[0]).sort()).toEqual(["id", "sidebar"]);
  });
});

describe("visibleSidebar", () => {
  const features: FeatureRuntime[] = [
    { id: "a", sidebar: [entry("open"), entry("second")] },
    { id: "b", sidebar: [] },
  ];

  // Shipped is the only gate: a feature that is in the build is everyone's.
  it("shows every entry of every shipped feature", () => {
    expect(visibleSidebar(features).map((e) => e.id)).toEqual(["open", "second"]);
  });

  it("preserves the build's order", () => {
    const reversed: FeatureRuntime[] = [features[1], features[0]];
    expect(visibleSidebar(reversed).map((e) => e.id)).toEqual(["open", "second"]);
  });
});

describe("featureEnabled", () => {
  const all = loadFeatures(repoRoot());

  it("reports what the build shipped", () => {
    const only = parseFeatures(featuresEnvValue(enabledFeatures(all, "docs")));
    expect(featureEnabled(only, "docs")).toBe(true);
    expect(featureEnabled(only, "attention")).toBe(false);
  });

  // An empty set means the env var never arrived. Treating that as "everything
  // is off" would 404 the whole app on a misconfigured deploy.
  it("reports false for an unknown id", () => {
    expect(featureEnabled([], "docs")).toBe(false);
  });
});

describe("isDisabledRoute", () => {
  const disabled = ["/dashboard/attention", "/api/v1/attention"];

  it("blocks the prefix itself and everything under it", () => {
    for (const p of [
      "/dashboard/attention",
      "/dashboard/attention/",
      "/dashboard/attention/boards/1",
      "/api/v1/attention/items",
    ]) {
      expect(isDisabledRoute(disabled, p)).toBe(true);
    }
  });

  // The bug a naive startsWith would ship: a different page that merely shares
  // a stem would 404 in every build that dropped the feature.
  it("does not block a path that only shares a stem", () => {
    for (const p of [
      "/dashboard/attention-training",
      "/dashboard/attentionx",
      "/api/v1/attentional",
    ]) {
      expect(isDisabledRoute(disabled, p)).toBe(false);
    }
  });

  it("blocks nothing when every feature shipped", () => {
    expect(isDisabledRoute([], "/dashboard/attention")).toBe(false);
  });

  it("leaves an enabled feature's routes alone", () => {
    expect(isDisabledRoute(disabled, "/dashboard/documents")).toBe(false);
  });
});

describe("parseDisabledRoutes", () => {
  it("degrades to empty rather than 404ing the whole app", () => {
    expect(parseDisabledRoutes(undefined)).toEqual([]);
    expect(parseDisabledRoutes("nope")).toEqual([]);
    expect(parseDisabledRoutes('{"a":1}')).toEqual([]);
  });

  it("round-trips the build's list", () => {
    const all = loadFeatures(repoRoot());
    const raw = disabledRoutesEnvValue(all, enabledFeatures(all, "docs"));
    expect(parseDisabledRoutes(raw)).toContain("/dashboard/attention");
    expect(parseDisabledRoutes(raw)).not.toContain("/dashboard/documents");
  });
});
