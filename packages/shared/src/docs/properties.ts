import type { JSONValue } from "./types";
import { splitFrontmatter } from "./markdown";
import { timestampMs } from "./doc-status";

// A document's properties as the database indexes them (docs.documents
// .properties and docs.doc_properties; see the doc_properties migration).
//
// Front matter goes in as it is written, with one change: YAML reads an
// unquoted date as a Date, which JSON can't hold, so it becomes the date it
// was written as. Rows flatten it so a fixed set of indexes covers any field:
// one row per field, one per item of a list, nested keys as "a.b", with the
// value also in the column of its kind when it reads as a number, a date or a
// boolean.

export interface PropertyRow {
  key: string;
  v_text: string;
  v_num: number | null;
  v_date: string | null;
  v_bool: boolean | null;
}

/** How deep nested keys are followed, and how many rows one document may have. */
const MAX_DEPTH = 4;
const MAX_ROWS = 500;
/** A longer value is kept whole in `properties` but cut short in its row. */
const MAX_TEXT = 1000;

type Value = JSONValue | Date | undefined;

/** A Date from YAML as the text it was written as: a bare date when it was one. */
function dateText(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

/** Front matter as JSON the database can store. */
export function propertiesJson(frontmatter: Record<string, JSONValue> | null): Record<string, JSONValue> {
  const clean = (v: Value | Record<string, Value>): JSONValue | undefined => {
    if (v === undefined) return undefined;
    if (v instanceof Date) return dateText(v);
    if (Array.isArray(v)) return v.map((x) => clean(x) ?? null);
    if (v !== null && typeof v === "object") {
      const out: Record<string, JSONValue> = {};
      for (const [k, x] of Object.entries(v as Record<string, Value>)) {
        const c = clean(x);
        if (c !== undefined) out[k] = c;
      }
      return out;
    }
    return v;
  };
  return (clean(frontmatter ?? {}) as Record<string, JSONValue>) ?? {};
}

function row(key: string, value: string | number | boolean): PropertyRow {
  if (typeof value === "boolean") return { key, v_text: String(value), v_num: null, v_date: null, v_bool: value };
  if (typeof value === "number") {
    return { key, v_text: String(value), v_num: Number.isFinite(value) ? value : null, v_date: null, v_bool: null };
  }
  const ms = timestampMs(value);
  return {
    key,
    v_text: value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value,
    v_num: null,
    v_date: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
    v_bool: null,
  };
}

/** The rows that index a document's properties. Null and empty values have none. */
export function propertyRows(properties: Record<string, JSONValue>): PropertyRow[] {
  const rows: PropertyRow[] = [];
  const walk = (key: string, value: JSONValue, depth: number): void => {
    if (rows.length >= MAX_ROWS || value === null || value === "") return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      rows.push(row(key, value));
    } else if (Array.isArray(value)) {
      for (const item of value) walk(key, item, depth);
    } else if (depth < MAX_DEPTH) {
      for (const [k, v] of Object.entries(value)) walk(`${key}.${k}`, v, depth + 1);
    }
  };
  for (const [key, value] of Object.entries(properties)) walk(key, value, 1);
  return rows;
}

/** A document's properties and their rows, from its markdown. */
export function indexProperties(markdown: string): { properties: Record<string, JSONValue>; rows: PropertyRow[] } {
  const properties = propertiesJson(splitFrontmatter(markdown).frontmatter);
  return { properties, rows: propertyRows(properties) };
}
