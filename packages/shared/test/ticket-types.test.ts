import { describe, it, expect } from "vitest";
import { isStatus, cleanNameList, TICKET_STATUSES } from "../src/types";
import { isPropertyId } from "../src/tickets";

describe("isStatus", () => {
  it("accepts every declared status", () => {
    for (const s of TICKET_STATUSES) expect(isStatus(s)).toBe(true);
  });
  it("rejects unknown values and nullish input", () => {
    for (const v of ["not_done", "closed", "", null, undefined]) {
      expect(isStatus(v)).toBe(false);
    }
  });
});

describe("isPropertyId", () => {
  it("accepts a uuid", () => {
    expect(isPropertyId("c19d6162-2c5e-4e86-9ca5-e921b9fd97a5")).toBe(true);
  });
  it("rejects non-uuid strings (guards the JSONB path interpolation)", () => {
    for (const v of ["", "abc", "1;drop", "properties->>x", null, undefined]) {
      expect(isPropertyId(v)).toBe(false);
    }
  });
});

describe("cleanNameList", () => {
  it("splits a comma string, trims, and drops blanks", () => {
    expect(cleanNameList("Alex, , Sam ,")).toEqual(["Alex", "Sam"]);
  });
  it("accepts an array and de-dupes (first wins)", () => {
    expect(cleanNameList(["Alex", "alex", "Alex", "Sam"])).toEqual(["Alex", "alex", "Sam"]);
  });
  it("returns an empty array for empty/undefined input", () => {
    expect(cleanNameList(undefined)).toEqual([]);
    expect(cleanNameList("")).toEqual([]);
  });
});
