import { describe, it, expect } from "vitest";
import { sidebarEntries } from "../src/sidebar";
import { loadFeatures, enabledFeatures, repoRoot } from "../src/load";

const all = loadFeatures(repoRoot());

describe("sidebarEntries", () => {
  // Shipped is the only gate: every entry of every enabled feature, for everyone.
  it("lists every entry of the enabled features", () => {
    const ids = sidebarEntries(all).map((e) => e.id);
    expect(ids).toContain("documents");
    expect(ids).toHaveLength(all.flatMap((f) => f.manifest.sidebar).length);
  });

  it("contributes nothing for a feature that is switched off", () => {
    const withoutDocs = enabledFeatures(
      all,
      all
        .map((f) => f.manifest.id)
        .filter((id) => id !== "docs")
        .join(",")
    );
    expect(sidebarEntries(withoutDocs).map((e) => e.id)).not.toContain("documents");
  });

  it("is ordered by feature id, so the sidebar does not reshuffle", () => {
    const a = sidebarEntries(all).map((e) => e.id);
    const b = sidebarEntries(loadFeatures(repoRoot())).map((e) => e.id);
    expect(a).toEqual(b);
  });

  it("every entry has a unique id across all features", () => {
    const ids = all.flatMap((f) => f.manifest.sidebar).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
