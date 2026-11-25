import type { JSONValue } from "./types";
import { CORE_FIELDS, readCoreFields, timestampMs, type CoreField } from "./doc-status";

// Views (doc types; design: "Doc types v2: fixed core, user types, rules" in
// the Markbase vault). A view is a saved way to look at documents: which ones
// (filter), in what order (sort), in what groups. It knows nothing about any
// kind of document in particular: Today is a view over documents of
// `type: task`, and a team's "open sev1 incidents" is a view over theirs.
//
// Pure: the server narrows the candidates with the property index and hands
// them here, so the API, an agent's tool and the tests all evaluate a view
// the same way.

export type {
  Scalar,
  Op,
  Condition,
  ViewSpec,
  ViewDoc,
  ViewContext,
  ViewRow,
  ViewResult,
} from "./view-types";
import type { Scalar, Op, Condition, ViewSpec, ViewDoc, ViewContext, ViewRow, ViewResult } from "./view-types";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/** The calendar day an instant falls on, in a time zone, as YYYY-MM-DD. */
export function dayIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/**
 * The day a date or date-time means for the viewer: a date is that date
 * wherever you are; a date-time is the day it falls on where you are. Null
 * when it isn't one.
 */
export function dayOf(value: string, timeZone: string): string | null {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const ms = timestampMs(t);
  return Number.isNaN(ms) ? null : dayIn(new Date(ms), timeZone);
}

/** `$me`, `$today`, `$today+7d` / `$today-1d`; anything else is itself. */
export function resolveValue(value: Scalar, ctx: ViewContext): Scalar {
  if (typeof value !== "string" || !value.startsWith("$")) return value;
  if (value === "$me") return ctx.me;
  const m = value.match(/^\$today(?:([+-])(\d+)d)?$/);
  if (!m) return value;
  const days = m[2] ? Number(m[2]) * (m[1] === "-" ? -1 : 1) : 0;
  // Noon of the asker's day, so adding days never lands on the wrong one across a DST change.
  const noon = new Date(`${dayIn(ctx.now, ctx.timeZone)}T12:00:00Z`);
  return new Date(noon.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** A field's value on a document, as the view reads it; undefined when missing. */
export function fieldValue(doc: ViewDoc, field: string): JSONValue | undefined {
  switch (field) {
    case "$id": return doc.id;
    case "$title": return doc.title;
    case "$path": return doc.path ?? undefined;
    case "$vault_id": return doc.vault_id ?? undefined;
    case "$updated_at": return doc.updated_at;
  }
  if ((CORE_FIELDS as readonly string[]).includes(field)) {
    const core = readCoreFields(doc.properties).fields;
    const name = field as CoreField;
    if (name === "owner") return core.owner ?? `human:${doc.owner_id}`;
    if (name === "verified") return undefined;
    const v = core[name as Exclude<CoreField, "verified">];
    if (v === null || (Array.isArray(v) && v.length === 0)) return undefined;
    return v as JSONValue;
  }
  const v = doc.properties[field];
  return v === null || v === "" ? undefined : v;
}

/** Order two values: numbers by number, dates by day, the rest as text. */
function compare(a: JSONValue, b: Scalar, ctx: ViewContext): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    const da = dayOf(a, ctx.timeZone);
    const db = dayOf(b, ctx.timeZone);
    if (da && db) return da < db ? -1 : da > db ? 1 : 0;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return null;
}

/** Whether a document meets a condition. */
export function matches(doc: ViewDoc, cond: Condition, ctx: ViewContext): boolean {
  if ("all" in cond) return cond.all.every((c) => matches(doc, c, ctx));
  if ("any" in cond) return cond.any.some((c) => matches(doc, c, ctx));
  if ("not" in cond) return !matches(doc, cond.not, ctx);

  const actual = fieldValue(doc, cond.field);
  if (cond.op === "exists") return actual !== undefined;
  if (cond.op === "missing") return actual === undefined;
  // A list matches when any of its items does; "ne" when none of them is equal.
  const items: JSONValue[] = actual === undefined ? [] : Array.isArray(actual) ? actual : [actual];
  const wanted = Array.isArray(cond.value) ? cond.value : [cond.value ?? null];
  const resolved = wanted.map((w) => resolveValue(w, ctx));
  const eq = (x: JSONValue) => resolved.some((w) => x === w || compare(x, w, ctx) === 0);
  switch (cond.op) {
    case "eq":
    case "in":
      return items.some(eq);
    case "ne":
      return !items.some(eq);
    default: {
      const target = resolved[0];
      return items.some((x) => {
        const c = compare(x, target, ctx);
        if (c === null) return false;
        return cond.op === "lt" ? c < 0 : cond.op === "lte" ? c <= 0 : cond.op === "gt" ? c > 0 : c >= 0;
      });
    }
  }
}

/**
 * Front matter every document a view can show must contain: its top-level
 * `field eq <literal>` conditions on fields read as written. The server hands
 * this to the property index (documents.properties @> …) to narrow the
 * candidates; the view itself still checks everything.
 */
export function requiredProperties(spec: ViewSpec): Record<string, Scalar> {
  const conds = spec.filter ? ("all" in spec.filter ? spec.filter.all : [spec.filter]) : [];
  const out: Record<string, Scalar> = {};
  for (const c of conds) {
    if (!("field" in c) || c.op !== "eq" || Array.isArray(c.value) || c.value === undefined || c.value === null) continue;
    if (c.field.startsWith("$")) continue;
    if (typeof c.value === "string" && c.value.startsWith("$")) continue;
    // Core fields are read, not taken as written (an owner defaults, done
    // defaults to false), except `type`, which is taken as written.
    if ((CORE_FIELDS as readonly string[]).includes(c.field) && c.field !== "type") continue;
    out[c.field] = c.value;
  }
  return out;
}

function groupKey(value: JSONValue | undefined, by: "value" | "day" | "relative_day", today: string, ctx: ViewContext): string {
  if (value === undefined) return "none";
  if (by === "value") return Array.isArray(value) ? String(value[0] ?? "none") : String(value);
  const day = typeof value === "string" ? dayOf(value, ctx.timeZone) : null;
  if (!day) return "none";
  if (by === "relative_day") return day < today ? "overdue" : day === today ? "today" : day;
  return day;
}

function sortValue(v: JSONValue | undefined, ctx: ViewContext): string | number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    // A date-time sorts by its instant; a date by the start of its day.
    const ms = timestampMs(v);
    if (!Number.isNaN(ms)) return ms;
    return v.toLowerCase();
  }
  void ctx;
  return JSON.stringify(v);
}

/** Evaluate a view over candidate documents. */
export function runView(spec: ViewSpec, docs: readonly ViewDoc[], ctx: ViewContext): ViewResult {
  const today = dayIn(ctx.now, ctx.timeZone);
  const limit = Math.min(Math.max(spec.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const chosen = docs.filter((d) => !spec.filter || matches(d, spec.filter, ctx));

  const sort = spec.sort ?? [{ field: "$updated_at", order: "desc" as const }];
  chosen.sort((a, b) => {
    for (const s of sort) {
      const va = sortValue(fieldValue(a, s.field), ctx);
      const vb = sortValue(fieldValue(b, s.field), ctx);
      if (va === vb) continue;
      if (va === undefined) return 1;
      if (vb === undefined) return -1;
      const c = va < vb ? -1 : 1;
      return s.order === "desc" ? -c : c;
    }
    return a.id < b.id ? -1 : 1;
  });

  const columns = spec.columns ?? ["$title"];
  const rows: ViewRow[] = chosen.slice(0, limit).map((d) => ({
    id: d.id,
    title: d.title,
    path: d.path,
    vault_id: d.vault_id,
    updated_at: d.updated_at,
    fields: Object.fromEntries(columns.map((c) => [c, fieldValue(d, c) ?? null])),
  }));

  const result: ViewResult = { name: spec.name, title: spec.title ?? spec.name, today, time_zone: ctx.timeZone, rows };
  if (spec.group_by) {
    const { field, by } = spec.group_by;
    const byId = new Map(chosen.map((d) => [d.id, d]));
    const groups = new Map<string, ViewRow[]>();
    for (const row of rows) {
      const key = groupKey(fieldValue(byId.get(row.id)!, field), by, today, ctx);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const rank = (k: string) => (k === "overdue" ? 0 : k === "today" ? 1 : k === "none" ? 3 : 2);
    result.groups = [...groups.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, rows]) => ({ key, rows }));
  }
  return result;
}

/**
 * Views every vault has. Today: open tasks for the asker, assigned to them or
 * to nobody in a document they own, due within a week or undated, by day.
 */
export const BUILTIN_VIEWS: Record<string, ViewSpec> = {
  today: {
    name: "today",
    title: "Today",
    filter: {
      all: [
        { field: "type", op: "eq", value: "task" },
        { field: "done", op: "ne", value: true },
        {
          any: [
            { field: "assignee", op: "eq", value: "$me" },
            { all: [{ field: "assignee", op: "missing" }, { field: "owner", op: "eq", value: "$me" }] },
          ],
        },
        { any: [{ field: "due", op: "missing" }, { field: "due", op: "lte", value: "$today+7d" }] },
      ],
    },
    sort: [{ field: "due" }, { field: "$title" }],
    group_by: { field: "due", by: "relative_day" },
    columns: ["$title", "due", "assignee"],
  },
};

/** A view spec from untrusted JSON (an agent's, or a request's), or the reason it isn't one. */
export function parseViewSpec(input: unknown): { spec: ViewSpec } | { error: string } {
  const OPS: readonly Op[] = ["eq", "ne", "in", "exists", "missing", "lt", "lte", "gt", "gte"];
  const isScalar = (v: unknown): v is Scalar => v === null || ["string", "number", "boolean"].includes(typeof v);
  const cond = (c: unknown, depth: number): string | null => {
    if (depth > 8) return "filter is nested too deeply";
    if (!c || typeof c !== "object" || Array.isArray(c)) return "a condition must be an object";
    const o = c as Record<string, unknown>;
    if ("all" in o || "any" in o) {
      const list = (o.all ?? o.any) as unknown;
      if (!Array.isArray(list)) return "all / any take a list of conditions";
      for (const x of list) {
        const e = cond(x, depth + 1);
        if (e) return e;
      }
      return null;
    }
    if ("not" in o) return cond(o.not, depth + 1);
    if (typeof o.field !== "string" || !o.field) return "a condition needs a field";
    if (!OPS.includes(o.op as Op)) return `op must be one of ${OPS.join(", ")}`;
    const v = o.value;
    if (v !== undefined && !isScalar(v) && !(Array.isArray(v) && v.every(isScalar))) return "value must be text, a number, true/false, null, or a list of them";
    return null;
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "a view must be an object" };
  const s = input as Record<string, unknown>;
  if (s.filter !== undefined) {
    const e = cond(s.filter, 0);
    if (e) return { error: e };
  }
  if (s.sort !== undefined && (!Array.isArray(s.sort) || !s.sort.every((x) => x && typeof (x as { field?: unknown }).field === "string"))) {
    return { error: "sort is a list of { field, order? }" };
  }
  if (s.group_by !== undefined) {
    const g = s.group_by as { field?: unknown; by?: unknown };
    if (typeof g?.field !== "string" || !["value", "day", "relative_day"].includes(g.by as string)) {
      return { error: "group_by is { field, by: value | day | relative_day }" };
    }
  }
  if (s.columns !== undefined && (!Array.isArray(s.columns) || !s.columns.every((c) => typeof c === "string"))) {
    return { error: "columns is a list of field names" };
  }
  if (s.limit !== undefined && (typeof s.limit !== "number" || !Number.isFinite(s.limit))) return { error: "limit is a number" };
  return { spec: { ...(s as unknown as ViewSpec), name: typeof s.name === "string" && s.name ? s.name : "custom" } };
}
