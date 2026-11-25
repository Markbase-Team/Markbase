import { describe, it, expect } from "vitest";
import { indexProperties, propertyRows } from "../../src/docs/properties";

describe("indexProperties", () => {
  it("has nothing for a document without front matter", () => {
    expect(indexProperties("# Title\n\nBody.")).toEqual({ properties: {}, rows: [] });
  });

  it("keeps front matter as written, with YAML dates as the dates they were", () => {
    const { properties } = indexProperties(
      "---\nseverity: sev1\nlast_drill: 2026-09-01\nstarted_at: 2026-11-20T10:30:00Z\ntags: [db, oncall]\n---\n\nBody.",
    );
    expect(properties).toEqual({
      severity: "sev1",
      last_drill: "2026-09-01",
      started_at: "2026-11-20T10:30:00.000Z",
      tags: ["db", "oncall"],
    });
    expect(JSON.parse(JSON.stringify(properties))).toEqual(properties);
  });

  it("indexes a field a team made up, with no setup", () => {
    const { rows } = indexProperties("---\nlast_drill: 2026-09-01\n---\n");
    expect(rows).toEqual([
      { key: "last_drill", v_text: "2026-09-01", v_num: null, v_date: "2026-09-01T00:00:00.000Z", v_bool: null },
    ]);
  });
});

describe("propertyRows", () => {
  it("puts each value in the column of its kind as well as text", () => {
    expect(propertyRows({ n: 3, ok: true, s: "sev1", d: "2026-12-31" })).toEqual([
      { key: "n", v_text: "3", v_num: 3, v_date: null, v_bool: null },
      { key: "ok", v_text: "true", v_num: null, v_date: null, v_bool: true },
      { key: "s", v_text: "sev1", v_num: null, v_date: null, v_bool: null },
      { key: "d", v_text: "2026-12-31", v_num: null, v_date: "2026-12-31T00:00:00.000Z", v_bool: null },
    ]);
  });

  it("gives each list item a row, and nested keys a dotted name", () => {
    const rows = propertyRows({ tags: ["a", "b"], contact: { name: "Sam", phones: ["1"] } });
    expect(rows.map((r) => `${r.key}=${r.v_text}`)).toEqual(["tags=a", "tags=b", "contact.name=Sam", "contact.phones=1"]);
  });

  it("skips empty values and keeps a number-looking string as text only", () => {
    const rows = propertyRows({ empty: "", none: null, zip: "02139" });
    expect(rows).toEqual([{ key: "zip", v_text: "02139", v_num: null, v_date: null, v_bool: null }]);
  });

  it("is bounded however large the front matter is", () => {
    const big = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`k${i}`, i]));
    expect(propertyRows(big).length).toBe(500);
    expect(propertyRows({ long: "x".repeat(5000) })[0].v_text.length).toBe(1000);
  });
});
