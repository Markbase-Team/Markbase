import type { JSONValue } from "./types";

// The shapes of a view and of what it answers (views.ts evaluates them). Apart
// from the engine and with nothing but types, so a page that only shows a
// view's answer imports no document code at all.

export type Scalar = string | number | boolean | null;

export type Op = "eq" | "ne" | "in" | "exists" | "missing" | "lt" | "lte" | "gt" | "gte";

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { field: string; op: Op; value?: Scalar | Scalar[] };

export interface ViewSpec {
  /** How it is asked for: "today". */
  name: string;
  /** How it is shown: "Today". */
  title?: string;
  filter?: Condition;
  /** In order of precedence. A document without the field sorts last either way. */
  sort?: { field: string; order?: "asc" | "desc" }[];
  /**
   * `value`: one group per value. `day`: one per calendar day (and "none").
   * `relative_day`: "overdue", "today", then one per later day, then "none".
   */
  group_by?: { field: string; by: "value" | "day" | "relative_day" };
  /** Fields to show for each document. */
  columns?: string[];
  /** At most this many documents (default 500). */
  limit?: number;
}

/**
 * A document as a view sees it. Fields are its front matter, plus `$id`,
 * `$title`, `$path`, `$vault_id` and `$updated_at`. A core field reads as
 * Markbase reads it: an `assignee` that isn't `human:<id>` / `agent:<name>`
 * is missing, `done` is false unless it is true, and `owner` is the front
 * matter's, else the document's creator.
 */
export interface ViewDoc {
  id: string;
  title: string;
  path: string | null;
  vault_id: string | null;
  owner_id: string;
  updated_at: string;
  properties: Record<string, JSONValue>;
}

/** What a view's values can refer to: who is asking, and when and where. */
export interface ViewContext {
  /** The asker: `human:<id>` or `agent:<name>`. */
  me: string;
  now: Date;
  timeZone: string;
}

export interface ViewRow {
  id: string;
  title: string;
  path: string | null;
  vault_id: string | null;
  updated_at: string;
  /** The view's columns, as the view reads them. */
  fields: Record<string, JSONValue>;
}

export interface ViewResult {
  name: string;
  title: string;
  /** The asker's day (YYYY-MM-DD), what `$today` meant. */
  today: string;
  time_zone: string;
  rows: ViewRow[];
  /** With `group_by`: the rows again, in groups, in order. */
  groups?: { key: string; rows: ViewRow[] }[];
}

