import { describe, it, expect } from "vitest";
import { personName, toolName, agentLabel } from "../src/attribution";
import { PROVIDERS, type Provider } from "../src/agent-sessions";

// How a version says who wrote it.
//
// Three writers edit the same Y.Doc — the browser, the agent API, and the vault
// daemon — and until now the author field was either empty or an email address.
// Neither answers the question a history list is actually asked: WHO did this,
// and if it was an agent, WHOSE agent.
//
// These are pure string functions on purpose. Composing the label is the part
// worth pinning down; resolving the inputs (an admin lookup, an API round trip)
// is the caller's problem, and mixing the two would make this untestable.

describe("personName", () => {
  // Supabase auth metadata carries full_name for OAuth sign-ins; email/password
  // signups often carry nothing at all. getUserDisplay already returns
  // { email, name } with name possibly null, so this is the whole fallback chain.
  it("prefers the display name from auth metadata", () => {
    expect(personName({ name: "Ada Lovelace", email: "ada.lovelace@example.com" })).toBe("Ada Lovelace");
  });

  // The codebase has no profiles table and no local-part fallback anywhere, so a
  // user without metadata would otherwise be attributed by full email address —
  // which then replicates inside the Y.Doc to everyone the doc is shared with.
  it("falls back to the email's local part, not the whole address", () => {
    expect(personName({ name: null, email: "ada.lovelace@example.com" })).toBe("ada.lovelace");
  });

  it("never returns an empty label", () => {
    expect(personName({ name: null, email: null })).toBe("Someone");
    expect(personName({ name: "   ", email: null })).toBe("Someone");
    expect(personName({ name: null, email: "   " })).toBe("Someone");
  });

  it("trims, so a stray space in metadata can't produce \"  's Claude Code\"", () => {
    expect(personName({ name: "  Jessie  ", email: null })).toBe("Jessie");
  });

  // An address with no @ is not an address; treating it as one would attribute
  // the edit to the literal string. Using it whole is the honest reading.
  it("handles an email-shaped value with no @", () => {
    expect(personName({ name: null, email: "operator" })).toBe("operator");
  });
});

describe("toolName", () => {
  it("names each provider the way its users would recognise it", () => {
    expect(toolName("claude_code")).toBe("Claude Code");
    expect(toolName("claude_desktop")).toBe("Claude Desktop");
    expect(toolName("codex")).toBe("Codex");
    expect(toolName("cursor")).toBe("Cursor");
  });

  // "unknown" is not a tool, it is the absence of one — the DB default for every
  // key minted before provider stamping existed. Returning a name for it would
  // invent a tool that never connected.
  it("has no name for an unstamped connection", () => {
    expect(toolName("unknown")).toBeNull();
  });

  // The provider set is CHECK-constrained in the database and mirrored by
  // PROVIDERS; a member with no branch here would render as undefined.
  it("covers every provider the database allows", () => {
    for (const p of PROVIDERS) {
      const name = toolName(p);
      expect(p === "unknown" ? name === null : typeof name === "string" && name.length > 0).toBe(true);
    }
  });
});

describe("agentLabel", () => {
  // The requirement in one line: an agent edit must say whose agent it was.
  it("names the owner and the tool", () => {
    expect(agentLabel("Jessie", "claude_code")).toBe("Jessie's Claude Code");
    expect(agentLabel("Jessie", "codex")).toBe("Jessie's Codex");
  });

  // A bearer token that never went through the MCP handshake sends no
  // X-MCP-Client, so its key is never stamped. Saying "agent" is honest;
  // guessing a tool would not be.
  it("says \"agent\" when the tool is unknown, rather than guessing one", () => {
    expect(agentLabel("Jessie", "unknown")).toBe("Jessie's agent");
  });

  // One possessive rule, applied to everyone. The alternative (bare apostrophe
  // for names ending in s) is a style debate that would make the label depend on
  // spelling, and "Chris' Claude Code" reads as a typo to most people.
  it("uses the same possessive for a name already ending in s", () => {
    expect(agentLabel("Chris", "claude_code")).toBe("Chris's Claude Code");
  });

  // Attribution must never be the thing that breaks: an owner we could not
  // resolve still produces a readable label.
  it("degrades to a generic owner rather than rendering \"'s Claude Code\"", () => {
    expect(agentLabel("", "claude_code")).toBe("Someone's Claude Code");
    expect(agentLabel("   ", "unknown")).toBe("Someone's agent");
  });

  it("produces a non-empty label for every provider", () => {
    for (const p of PROVIDERS as readonly Provider[]) {
      expect(agentLabel("Jessie", p).startsWith("Jessie's ")).toBe(true);
    }
  });
});
