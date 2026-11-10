import { describe, it, expect } from "vitest";
import {
  CLAUDE_CODE_FEATURES,
  getFeature,
  isFeatureEnabled,
  requiresClaudeCode,
} from "../src/features";

const WITH = { claudeCode: true };
const WITHOUT = { claudeCode: false };

describe("claude-code feature registry", () => {
  it("gates every registered feature on a local Claude Code install", () => {
    for (const f of CLAUDE_CODE_FEATURES) {
      expect(isFeatureEnabled(f.id, WITHOUT)).toBe(false);
      expect(isFeatureEnabled(f.id, WITH)).toBe(true);
    }
  });

  it("gates dispatch, not the board itself", () => {
    // A ticket tracker works without Claude Code; only handing work to an agent needs it.
    expect(requiresClaudeCode("ticketing")).toBe(false);
    const ids = CLAUDE_CODE_FEATURES.map((f) => f.id);
    expect(ids).toContain("ticketDispatch");
    expect(ids).toContain("agents");
    expect(ids).toContain("mentionReply");
  });

  it("leaves unregistered features on — forgetting to register can't lock a user out", () => {
    expect(requiresClaudeCode("documents")).toBe(false);
    expect(isFeatureEnabled("documents", WITHOUT)).toBe(true);
  });

  it("gives every feature a name and a blurb for the quickstart page", () => {
    for (const f of CLAUDE_CODE_FEATURES) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.blurb.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    const ids = CLAUDE_CODE_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("throws on an unknown feature rather than inventing one", () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => getFeature("nope")).toThrow(/unknown feature/);
  });
});
