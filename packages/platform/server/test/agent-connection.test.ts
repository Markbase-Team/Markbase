import { describe, it, expect, vi, beforeEach } from "vitest";

// "Has this account connected an agent?" is asked before the app offers
// "Connect an agent". What is under test is which keys count: a working key,
// other than the desktop app's own sign-in.

interface Filter {
  op: "eq" | "not";
  column: string;
  operator?: string;
  value: string | null;
}

const filters: Filter[] = [];
let found: { id: string }[] = [];
let failure: { message: string } | null = null;

vi.mock("../src/supabase", () => {
  const query = {
    select: () => query,
    eq: (column: string, value: string) => {
      filters.push({ op: "eq", column, value });
      return query;
    },
    not: (column: string, operator: string, value: string | null) => {
      filters.push({ op: "not", column, operator, value });
      return query;
    },
    limit: async () => ({ data: failure ? null : found, error: failure }),
  };
  return { supabase: { from: () => query } };
});

const { hasAgentConnection, DESKTOP_KEY_NAME } = await import("../src/api-keys");

beforeEach(() => {
  filters.length = 0;
  found = [];
  failure = null;
});

describe("hasAgentConnection", () => {
  it("is true when the account holds a key that counts", async () => {
    found = [{ id: "key_1" }];
    expect(await hasAgentConnection("owner_1")).toBe(true);
  });

  it("is false when it holds none", async () => {
    expect(await hasAgentConnection("owner_1")).toBe(false);
  });

  it("counts this account's confirmed keys, leaving out the desktop app's own", async () => {
    await hasAgentConnection("owner_1");
    expect(filters).toEqual([
      { op: "eq", column: "owner_id", value: "owner_1" },
      // minted but never collected by its client: nothing is connected
      { op: "not", column: "confirmed_at", operator: "is", value: null },
      { op: "not", column: "name", operator: "like", value: `${DESKTOP_KEY_NAME}%` },
    ]);
  });

  it("throws rather than guess when the keys cannot be read", async () => {
    failure = { message: "db down" };
    await expect(hasAgentConnection("owner_1")).rejects.toEqual({ message: "db down" });
  });
});
