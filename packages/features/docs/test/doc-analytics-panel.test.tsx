import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocAnalyticsReport } from "@markbase/protocol/docs/analytics";

// The Analytics panel as a person sees it, from the response the endpoint
// gives. The read row below is the one GET /docs/:id/analytics returned on
// 2026-11-19 after Claude Code read a vault file once through its hook.

let report: DocAnalyticsReport | null = null;
vi.mock("../src/ui/use-doc-analytics", () => ({
  useDocAnalytics: () => ({ analytics: report, loading: false }),
}));

const { DocAnalytics } = await import("../src/ui/doc-analytics");
const text = (): string =>
  renderToStaticMarkup(<DocAnalytics docId="doc_1" />)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("DocAnalytics", () => {
  it("shows an agent's read with whose agent it was and the count", () => {
    report = {
      reads: [{ agent: "claude", owner: "Markbase", count: 1, lastAt: 1795118667027, text: "Markbase's Claude" }],
      credit: null,
    };
    const shown = text();
    expect(shown).toContain("Read by agents");
    expect(shown).toMatch(/1\s+read\b/);
    expect(shown).toContain("Markbase's Claude");
    expect(shown).not.toContain("No agent has read");
  });

  it("sums the reads in the heading", () => {
    report = {
      reads: [
        { agent: "claude", owner: "Jessie", count: 3, lastAt: 1795118667027, text: "Jessie's Claude" },
        { agent: "codex", owner: "Jessie", count: 2, lastAt: 1795118667027, text: "Jessie's Codex" },
      ],
      credit: null,
    };
    expect(text()).toMatch(/5\s+reads\b/);
  });

  it("with no reads, says the hooks come with the app and mcp install, not a separate command", () => {
    report = { reads: [], credit: null };
    const shown = text();
    expect(shown).toContain("No agent has read this file yet.");
    expect(shown).toContain("npx @markbase/cli mcp install");
    expect(shown).toContain("desktop app");
    expect(shown).not.toContain("audit install");
  });
});
