import { describe, it, expect, vi, beforeEach } from "vitest";

// A daemon sends several requests a second under one key. What is under test:
// that checking the key costs one lookup per window, not one per request, and
// that `last_used_at` is written only when it has gone stale.

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  created_at: string;
  owner_id: string;
  capability: string | null;
  provider: string;
  claude_version: string | null;
}

const selects = vi.fn();
const updates = vi.fn();
let row: KeyRow | null = null;

vi.mock("@markbase/protocol/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        not: () => ({
          eq: () => ({
            maybeSingle: async () => {
              selects();
              return { data: row, error: null };
            },
          }),
        }),
      }),
      update: (patch: { last_used_at: string }) => ({
        eq: async () => {
          updates(patch);
          return { error: null };
        },
      }),
      delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  },
}));

const { verifyApiKey, deleteApiKey, forgetVerifiedKeys, KEY_CACHE_MS, LAST_USED_EVERY_MS } = await import(
  "../src/api-keys"
);

const T0 = Date.parse("2026-11-17T12:00:00Z");
const keyRow = (lastUsedAt: string | null): KeyRow => ({
  id: "key_1",
  name: "Desktop",
  key_prefix: "mb_abc",
  scopes: ["read", "write"],
  last_used_at: lastUsedAt,
  created_at: "2026-11-01T00:00:00Z",
  owner_id: "owner_1",
  capability: null,
  provider: "unknown",
  claude_version: null,
});

beforeEach(() => {
  forgetVerifiedKeys();
  selects.mockClear();
  updates.mockClear();
  row = keyRow(null);
});

describe("verifyApiKey", () => {
  it("looks a key up once per window, however many requests carry it", async () => {
    for (let i = 0; i < 20; i++) expect((await verifyApiKey("tok", T0 + i * 1000))?.id).toBe("key_1");
    expect(selects).toHaveBeenCalledTimes(1);
    await verifyApiKey("tok", T0 + KEY_CACHE_MS);
    expect(selects).toHaveBeenCalledTimes(2);
  });

  it("writes last_used_at only when it has gone stale", async () => {
    row = keyRow(new Date(T0 - 60_000).toISOString());
    await verifyApiKey("tok", T0);
    expect(updates).not.toHaveBeenCalled();

    forgetVerifiedKeys();
    row = keyRow(new Date(T0 - LAST_USED_EVERY_MS).toISOString());
    await verifyApiKey("tok", T0);
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it("never caches a key that did not verify", async () => {
    row = null;
    expect(await verifyApiKey("tok", T0)).toBeNull();
    expect(await verifyApiKey("tok", T0 + 1)).toBeNull();
    expect(selects).toHaveBeenCalledTimes(2);
  });

  it("forgets a key deleted through this instance at once", async () => {
    await verifyApiKey("tok", T0);
    await deleteApiKey("key_1", "owner_1");
    row = null;
    expect(await verifyApiKey("tok", T0 + 1)).toBeNull();
  });
});
