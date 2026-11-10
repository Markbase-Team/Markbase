import { describe, it, expect } from "vitest";
import { resolveOwnerFields } from "../src/tickets";
import { isOwnerKind, OWNER_KINDS } from "../src/types";

// A ticket is assigned to the user, or to one of their *named agent sessions*
// (agent_sessions.id) — not to a raw API-key connection. These lock that model
// and keep create + update resolving identically.
describe("resolveOwnerFields", () => {
  it("defaults to the user and clears any session when nothing is given", () => {
    expect(resolveOwnerFields({})).toEqual({
      owner_kind: "user",
      agent_session_id: null,
    });
  });

  it("keeps the session id when assigned to an agent", () => {
    expect(
      resolveOwnerFields({ ownerKind: "agent", agentSessionId: "sess-row-1" })
    ).toEqual({ owner_kind: "agent", agent_session_id: "sess-row-1" });
  });

  it("naming a session implies the agent kind", () => {
    expect(resolveOwnerFields({ agentSessionId: "sess-row-1" })).toEqual({
      owner_kind: "agent",
      agent_session_id: "sess-row-1",
    });
  });

  it("agent with no session resolves to an unspecified agent", () => {
    expect(resolveOwnerFields({ ownerKind: "agent" })).toEqual({
      owner_kind: "agent",
      agent_session_id: null,
    });
  });

  it("assigning to the user clears a previously set session", () => {
    expect(
      resolveOwnerFields({ ownerKind: "user", agentSessionId: "leftover" })
    ).toEqual({ owner_kind: "user", agent_session_id: null });
  });

  it("never emits the legacy enum values", () => {
    const { owner_kind } = resolveOwnerFields({ ownerKind: "agent", agentSessionId: "s" });
    expect(["markbase", "claude_code", "jessie"]).not.toContain(owner_kind);
    expect(OWNER_KINDS).toContain(owner_kind);
  });
});

describe("isOwnerKind", () => {
  it("accepts the two valid kinds", () => {
    expect(isOwnerKind("user")).toBe(true);
    expect(isOwnerKind("agent")).toBe(true);
  });

  it("rejects legacy/invalid values and nullish input", () => {
    for (const v of ["markbase", "claude_code", "jessie", "", "USER", null, undefined]) {
      expect(isOwnerKind(v)).toBe(false);
    }
  });
});
