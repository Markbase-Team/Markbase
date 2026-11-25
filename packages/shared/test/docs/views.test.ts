import { describe, it, expect } from "vitest";
import {
  BUILTIN_VIEWS,
  dayOf,
  matches,
  parseViewSpec,
  requiredProperties,
  resolveValue,
  runView,
  type ViewContext,
  type ViewDoc,
} from "../../src/docs/views";
import type { JSONValue } from "../../src/docs/types";

const ME = "human:me";
// 9pm on Nov 25 in Los Angeles: already the 26th in UTC.
const ctx: ViewContext = { me: ME, now: new Date("2026-11-26T05:00:00Z"), timeZone: "America/Los_Angeles" };

const doc = (title: string, properties: Record<string, JSONValue>, owner_id = "me"): ViewDoc => ({
  id: title, title, path: null, vault_id: "v1", owner_id, updated_at: "2026-11-20T00:00:00Z", properties,
});
const titles = (docs: ViewDoc[], spec = BUILTIN_VIEWS.today, c = ctx) => runView(spec, docs, c).rows.map((r) => r.title);

describe("values", () => {
  it("resolves $me and days relative to the asker's today", () => {
    expect(resolveValue("$me", ctx)).toBe(ME);
    expect(resolveValue("$today", ctx)).toBe("2026-11-25");
    expect(resolveValue("$today+7d", ctx)).toBe("2026-12-02");
    expect(resolveValue("$today-1d", ctx)).toBe("2026-11-24");
    expect(resolveValue("plain", ctx)).toBe("plain");
  });

  it("reads a date as that day anywhere, and a date-time as its day where the asker is", () => {
    expect(dayOf("2026-11-28", "Asia/Shanghai")).toBe("2026-11-28");
    expect(dayOf("2026-11-28T03:00:00Z", "America/Los_Angeles")).toBe("2026-11-27");
    expect(dayOf("not a date", "UTC")).toBeNull();
  });
});

describe("the Today view", () => {
  const docs = [
    doc("Mine, due soon", { type: "task", due: "2026-11-26" }),
    doc("Mine, no due", { type: "task" }),
    doc("Mine, done", { type: "task", done: true }),
    doc("Mine, due far", { type: "task", due: "2027-03-01" }),
    doc("In my doc, for Sam", { type: "task", assignee: "human:sam" }),
    doc("Sam's doc, for me", { type: "task", assignee: ME, due: "2026-11-20" }, "sam"),
    doc("Not a task", { due: "2026-11-26" }),
    doc("Bad assignee, so mine", { type: "task", assignee: "jessie" }),
    doc("For claude", { type: "task", assignee: "agent:claude" }),
    doc("Owner field says Sam", { type: "task", owner: "human:sam" }),
    doc("Due today", { type: "task", due: "2026-11-25" }),
  ];

  it("shows what is mine and open, due within a week or undated, earliest first", () => {
    expect(titles(docs)).toEqual(["Sam's doc, for me", "Due today", "Mine, due soon", "Bad assignee, so mine", "Mine, no due"]);
  });

  it("groups by the asker's day: overdue, today, later days, no date", () => {
    const { groups } = runView(BUILTIN_VIEWS.today, docs, ctx);
    expect(groups!.map((g) => [g.key, g.rows.map((r) => r.title)])).toEqual([
      ["overdue", ["Sam's doc, for me"]],
      ["today", ["Due today"]],
      ["2026-11-26", ["Mine, due soon"]],
      ["none", ["Bad assignee, so mine", "Mine, no due"]],
    ]);
  });

  it("shows an agent the tasks assigned to it, and nothing that merely has no assignee", () => {
    expect(titles(docs, BUILTIN_VIEWS.today, { ...ctx, me: "agent:claude" })).toEqual(["For claude"]);
  });

  it("narrows candidates by type only: everything else is read, not taken as written", () => {
    expect(requiredProperties(BUILTIN_VIEWS.today)).toEqual({ type: "task" });
  });
});

describe("a team's own view", () => {
  const incidents = [
    doc("DB failover", { type: "incident", severity: "sev1", resolved: false, started_at: "2026-11-20T10:00:00Z", tags: ["db", "oncall"] }),
    doc("Cache miss storm", { type: "incident", severity: "sev2", resolved: false, started_at: "2026-11-22T10:00:00Z" }),
    doc("Old outage", { type: "incident", severity: "sev1", resolved: true, started_at: "2026-10-01T10:00:00Z" }),
    doc("Queue backlog", { type: "incident", severity: "sev1", resolved: false, started_at: "2026-11-24T08:00:00Z", tags: ["queue"] }),
  ];

  it("filters on any field, sorts and groups by value", () => {
    const spec = parseViewSpec({
      name: "open-sev1",
      filter: { all: [{ field: "type", op: "eq", value: "incident" }, { field: "severity", op: "eq", value: "sev1" }, { field: "resolved", op: "ne", value: true }] },
      sort: [{ field: "started_at", order: "desc" }],
      group_by: { field: "severity", by: "value" },
      columns: ["$title", "started_at"],
    });
    if ("error" in spec) throw new Error(spec.error);
    const result = runView(spec.spec, incidents, ctx);
    expect(result.rows.map((r) => r.title)).toEqual(["Queue backlog", "DB failover"]);
    expect(result.rows[0].fields).toEqual({ $title: "Queue backlog", started_at: "2026-11-24T08:00:00Z" });
    expect(result.groups).toEqual([{ key: "sev1", rows: result.rows }]);
    expect(requiredProperties(spec.spec)).toEqual({ type: "incident", severity: "sev1" });
  });

  it("matches a list when any item does, and ranges by day", () => {
    const tagged = (t: string) => matches(incidents[0], { field: "tags", op: "eq", value: t }, ctx);
    expect(tagged("db")).toBe(true);
    expect(tagged("queue")).toBe(false);
    expect(matches(incidents[0], { field: "tags", op: "in", value: ["queue", "oncall"] }, ctx)).toBe(true);
    expect(titles(incidents, { name: "x", filter: { field: "started_at", op: "gte", value: "$today-2d" } })).toEqual(["Queue backlog"]);
  });
});

describe("parseViewSpec", () => {
  it("refuses what isn't a view, with the reason", () => {
    expect(parseViewSpec(null)).toEqual({ error: "a view must be an object" });
    expect(parseViewSpec({ filter: { field: "a", op: "like", value: "%" } })).toMatchObject({ error: expect.stringContaining("op must be") });
    expect(parseViewSpec({ filter: { field: "a", op: "eq", value: { $where: 1 } } })).toMatchObject({ error: expect.stringContaining("value must be") });
    expect(parseViewSpec({ group_by: { field: "a", by: "week" } })).toMatchObject({ error: expect.stringContaining("group_by") });
    let deep: unknown = { field: "a", op: "exists" };
    for (let i = 0; i < 12; i++) deep = { not: deep };
    expect(parseViewSpec({ filter: deep })).toEqual({ error: "filter is nested too deeply" });
  });

  it("names an unnamed view `custom`", () => {
    expect(parseViewSpec({})).toEqual({ spec: { name: "custom" } });
  });
});
