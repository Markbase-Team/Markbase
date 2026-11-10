import { describe, it, expect } from "vitest";
import {
  isTransientDbError,
  retryingDb,
  DB_MAX_ATTEMPTS,
  type DbError,
} from "../src/logic/crdt-supabase";

// Retrying the CRDT store, and — more important — NOT retrying it.
//
// postgrest-js retries GET/HEAD/OPTIONS on a dropped connection, and only 520/503
// by status. Our upsert is a POST, so the one write in the sync loop had no
// protection at all, however idempotent it is (it is keyed on the primary key).
// Meanwhile a foreign-key violation will fail identically forever: retrying it
// just delays the report and holds the vault's serial open loop hostage.

const noSleep = async (): Promise<void> => {};

function failing(times: number, error: DbError, status?: number) {
  let calls = 0;
  return {
    calls: () => calls,
    run: async () => {
      calls++;
      return calls <= times
        ? { data: null, error, status }
        : { data: { state: "ok" }, error: null, status: 200 };
    },
  };
}

describe("isTransientDbError", () => {
  it("treats a codeless error as transport failure — it never reached the service", () => {
    // This is the exact shape of the failure that duplicated a document.
    expect(isTransientDbError({ message: "TypeError: terminated" })).toBe(true);
    expect(isTransientDbError({ message: "fetch failed", code: "" })).toBe(true);
  });

  it("retries genuine server wobbles", () => {
    expect(isTransientDbError({ message: "timeout", code: "57014" })).toBe(true);
    expect(isTransientDbError({ message: "too many clients", code: "53300" })).toBe(true);
    expect(isTransientDbError({ message: "deadlock", code: "40P01" })).toBe(true);
  });

  it("refuses to retry a request that is simply wrong", () => {
    // A doc deleted upstream: seeding its CRDT violates the foreign key. Forever.
    expect(isTransientDbError({ message: "FK violation", code: "23503" })).toBe(false);
    expect(isTransientDbError({ message: "denied", code: "42501" })).toBe(false);
    expect(isTransientDbError({ message: "no rows", code: "PGRST116" })).toBe(false);
  });

  it("judges by status when there is one, including the ones the library skips", () => {
    expect(isTransientDbError({ message: "rate limited", code: "x" }, 429)).toBe(true);
    expect(isTransientDbError({ message: "bad gateway", code: "x" }, 502)).toBe(true);
    expect(isTransientDbError({ message: "conflict", code: "23505" }, 409)).toBe(false);
  });
});

describe("retryingDb", () => {
  it("succeeds on a later attempt after transport failures", async () => {
    const f = failing(2, { message: "TypeError: terminated" });
    const out = await retryingDb("load", f.run, undefined, noSleep);
    expect(out).toEqual({ state: "ok" });
    expect(f.calls()).toBe(3);
  });

  it("gives up after the attempt limit, keeping the original message", async () => {
    const f = failing(99, { message: "TypeError: terminated" });
    await expect(retryingDb("load x", f.run, undefined, noSleep)).rejects.toThrow(
      "load x: TypeError: terminated"
    );
    expect(f.calls()).toBe(DB_MAX_ATTEMPTS);
  });

  it("does not retry a permanent error — one attempt, then report", async () => {
    const f = failing(99, { message: "FK violation", code: "23503" });
    await expect(retryingDb("save", f.run, undefined, noSleep)).rejects.toThrow("FK violation");
    expect(f.calls()).toBe(1);
  });

  it("treats a thrown exception as a failed attempt, not a crash", async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      if (calls === 1) throw new TypeError("terminated");
      return { data: "fine", error: null };
    };
    expect(await retryingDb("load", run, undefined, noSleep)).toBe("fine");
    expect(calls).toBe(2);
  });

  it("reports each retry so a degraded link is visible, not silent", async () => {
    const seen: number[] = [];
    const f = failing(2, { message: "fetch failed" });
    await retryingDb("load", f.run, (attempt) => seen.push(attempt), noSleep);
    expect(seen).toEqual([1, 2]);
  });

  it("returns immediately when the first attempt works", async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      return { data: 42, error: null };
    };
    expect(await retryingDb("load", run, undefined, noSleep)).toBe(42);
    expect(calls).toBe(1);
  });
});
