import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { ViewResult, ViewRow } from "@markbase/shared/docs/view-types";

// Today as a person sees it, from what the view `today` answers. The shell's
// navigation is a stand-in that says where a document lives.

vi.mock("@markbase/ui/navigation", () => ({
  useNavigation: () => ({
    routes: { document: (id: string) => `/dashboard/documents/${id}` },
    Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
      <a href={href} className={className}>{children}</a>
    ),
  }),
}));

const { TodayBody, groupLabel } = await import("../src/ui/today");

const row = (id: string, title: string, due: string | null, assignee: string | null = "human:u1"): ViewRow => ({
  id, title, path: null, vault_id: null, updated_at: "2026-11-20T00:00:00Z", fields: { $title: title, due, assignee },
});

const view = (groups: { key: string; rows: ViewRow[] }[]): ViewResult => ({
  name: "today",
  title: "Today",
  today: "2026-11-25",
  time_zone: "America/Los_Angeles",
  rows: groups.flatMap((g) => g.rows),
  groups,
});

const render = (props: Partial<Parameters<typeof TodayBody>[0]>) =>
  renderToStaticMarkup(<TodayBody view={null} error={null} loading={false} onFinish={() => {}} {...props} />);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("TodayBody", () => {
  it("shows the view's groups in order, each task linking to its document", () => {
    const html = render({
      view: view([
        { key: "overdue", rows: [row("d1", "Send the draft", "2026-11-24")] },
        { key: "today", rows: [row("d2", "Update the runbook", "2026-11-25", null)] },
        { key: "2026-11-27", rows: [row("d3", "Load test", "2026-11-27T17:00:00Z")] },
        { key: "none", rows: [row("d4", "Clean up the wiki", null)] },
      ]),
    });
    const shown = text(html);
    expect(shown).toMatch(/Wed, Nov 25 · 4 open/);
    const order = ["Overdue", "Send the draft", "Today", "Update the runbook", "Fri, Nov 27", "Load test", "No due date", "Clean up the wiki"];
    const positions = order.map((s) => shown.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('href="/dashboard/documents/d2"');
    expect(shown).toContain("yours by default");
    expect(html).toContain("aria-label=\"Mark “Update the runbook” done\"");
  });

  it("says nothing needs you, and that a task is any document of type: task", () => {
    const shown = text(render({ view: view([]) }));
    expect(shown).toContain("nothing open");
    expect(shown).toContain("type: task");
  });

  it("says it is loading, or why it couldn't", () => {
    expect(text(render({ loading: true }))).toContain("Loading your tasks");
    expect(text(render({ error: "HTTP 500" }))).toContain("Couldn't load your tasks: HTTP 500");
  });
});

describe("groupLabel", () => {
  it("names the view's group keys", () => {
    expect(groupLabel("overdue")).toBe("Overdue");
    expect(groupLabel("today")).toBe("Today");
    expect(groupLabel("none")).toBe("No due date");
    expect(groupLabel("2026-11-27")).toBe("Fri, Nov 27");
    expect(groupLabel("sev1")).toBe("sev1");
  });
});
