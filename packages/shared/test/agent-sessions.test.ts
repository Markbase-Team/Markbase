import { describe, it, expect } from "vitest";
import {
  isProvider,
  providerFromClient,
  mintSessionToken,
  reconcileSessions,
  claimedStatus,
  PROVIDERS,
  type StoredForReconcile,
} from "../src/agent-sessions";

describe("isProvider", () => {
  it("accepts every declared provider", () => {
    for (const p of PROVIDERS) expect(isProvider(p)).toBe(true);
  });
  it("rejects unknown strings and nullish input", () => {
    for (const v of ["gpt", "", "Claude_Code", null, undefined]) {
      expect(isProvider(v)).toBe(false);
    }
  });
});

describe("providerFromClient", () => {
  it("maps MCP client names to providers", () => {
    expect(providerFromClient("claude-code")).toBe("claude_code");
    expect(providerFromClient("Claude Code/1.2")).toBe("claude_code");
    expect(providerFromClient("claude-desktop")).toBe("claude_desktop");
    expect(providerFromClient("Codex CLI")).toBe("codex");
    expect(providerFromClient("cursor")).toBe("cursor");
  });
  it("falls back to unknown rather than guessing", () => {
    expect(providerFromClient("some-random-client")).toBe("unknown");
    expect(providerFromClient("")).toBe("unknown");
    expect(providerFromClient(undefined)).toBe("unknown");
  });
});

describe("mintSessionToken", () => {
  it("is prefixed and unique", () => {
    const a = mintSessionToken();
    const b = mintSessionToken();
    expect(a.startsWith("sess_")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("reconcileSessions", () => {
  // last_seen defaults to null => outside any grace window (marked missing).
  const row = (
    id: string,
    ext: string | null,
    status: StoredForReconcile["status"],
    last_seen: string | null = null
  ): StoredForReconcile => ({ id, external_session_id: ext, status, last_seen });

  it("activates present sessions and marks vanished ones missing", () => {
    const stored = [row("a", "x1", "active"), row("b", "x2", "active")];
    const r = reconcileSessions(stored, ["x1"]);
    expect(r.activate).toEqual(["a"]);
    expect(r.markMissing).toEqual(["b"]);
    expect(r.newExternalIds).toEqual([]);
  });

  it("reports live ids we've never recorded as new", () => {
    const stored = [row("a", "x1", "active")];
    const r = reconcileSessions(stored, ["x1", "x9"]);
    expect(r.newExternalIds).toEqual(["x9"]);
    expect(r.markMissing).toEqual([]);
  });

  it("empty live set marks all active/idle rows missing", () => {
    const stored = [row("a", "x1", "active"), row("b", "x2", "idle")];
    const r = reconcileSessions(stored, []);
    expect(r.markMissing.sort()).toEqual(["a", "b"]);
    expect(r.activate).toEqual([]);
  });

  it("leaves ended/missing rows untouched and never re-inserts their ids", () => {
    const stored = [row("a", "x1", "missing"), row("b", "x2", "ended")];
    // even if x1/x2 reappear upstream, reconcile doesn't resurrect, re-kill, or
    // duplicate them (their ids are already known -> the unique index is safe).
    const r = reconcileSessions(stored, ["x1", "x2"]);
    expect(r.activate).toEqual([]);
    expect(r.markMissing).toEqual([]);
    expect(r.newExternalIds).toEqual([]);
  });

  it("ignores pending rows (no external id yet)", () => {
    const stored = [row("p", null, "pending")];
    const r = reconcileSessions(stored, []);
    expect(r.activate).toEqual([]);
    expect(r.markMissing).toEqual([]);
  });

  // A just-spawned session is bound before the provider writes its session file;
  // a sweep racing ahead must not declare its memory deleted.
  it("spares a freshly-bound session from being marked missing", () => {
    const now = 1_000_000_000_000;
    const justNow = new Date(now - 10_000).toISOString();
    const stored = [row("fresh", "x1", "active", justNow)];
    const r = reconcileSessions(stored, [], { nowMs: now, graceMs: 60_000 });
    expect(r.markMissing).toEqual([]);
  });

  it("marks it missing once the grace window has passed", () => {
    const now = 1_000_000_000_000;
    const longAgo = new Date(now - 10 * 60_000).toISOString();
    const stored = [row("stale", "x1", "active", longAgo)];
    const r = reconcileSessions(stored, [], { nowMs: now, graceMs: 60_000 });
    expect(r.markMissing).toEqual(["stale"]);
  });
});

describe("claimedStatus", () => {
  it("activates a live or pending session", () => {
    expect(claimedStatus("pending")).toBe("active");
    expect(claimedStatus("active")).toBe("active");
    expect(claimedStatus("idle")).toBe("active");
  });
  it("refuses to resurrect a dead session (memory gone)", () => {
    expect(claimedStatus("ended")).toBeNull();
    expect(claimedStatus("missing")).toBeNull();
  });
});
