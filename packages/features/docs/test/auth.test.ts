import { describe, it, expect } from "vitest";
import { capabilityFor, atLeast, type Actor } from "../src/server/auth";

const OWNER = "user-owner";
const user = (userId: string): Actor => ({ kind: "user", userId, name: "u" });
const agent = (userId: string): Actor => ({ kind: "agent", userId, name: "bot" });
const guest = (): Actor => ({ kind: "guest", name: "Anon" });

describe("capabilityFor", () => {
  it("owner beats any grant", () => {
    expect(
      capabilityFor({ ownerId: OWNER, actor: user(OWNER), memberCapability: "viewer", guestCapability: null })
    ).toBe("owner");
  });

  it("a member resolves to their grant", () => {
    expect(
      capabilityFor({ ownerId: OWNER, actor: user("u2"), memberCapability: "editor", guestCapability: null })
    ).toBe("editor");
  });

  it("a non-member, non-owner user has no capability", () => {
    expect(
      capabilityFor({ ownerId: OWNER, actor: user("stranger"), memberCapability: null, guestCapability: null })
    ).toBeNull();
  });

  it("an agent inherits its key-owner's capability (owner)", () => {
    expect(
      capabilityFor({ ownerId: OWNER, actor: agent(OWNER), memberCapability: null, guestCapability: null })
    ).toBe("owner");
  });

  it("an agent inherits its key-owner's member grant", () => {
    expect(
      capabilityFor({ ownerId: OWNER, actor: agent("u2"), memberCapability: "editor", guestCapability: null })
    ).toBe("editor");
  });

  it("a guest only ever gets the guest-link capability", () => {
    expect(
      capabilityFor({ ownerId: OWNER, actor: guest(), memberCapability: "editor", guestCapability: "commenter" })
    ).toBe("commenter");
    expect(
      capabilityFor({ ownerId: OWNER, actor: guest(), memberCapability: null, guestCapability: null })
    ).toBeNull();
  });

  it("a key's capabilityCap lowers an agent below its owner", () => {
    // Agent on its owner's doc would be owner, but the key is capped to commenter.
    expect(
      capabilityFor({
        ownerId: OWNER,
        actor: { ...agent(OWNER), capabilityCap: "commenter" },
        memberCapability: null,
        guestCapability: null,
      })
    ).toBe("commenter");
  });

  it("capabilityCap is a ceiling — it never raises access", () => {
    // Member grant is viewer; a higher cap can't lift it.
    expect(
      capabilityFor({
        ownerId: OWNER,
        actor: { ...agent("u2"), capabilityCap: "owner" },
        memberCapability: "viewer",
        guestCapability: null,
      })
    ).toBe("viewer");
    // No underlying access stays null regardless of the cap.
    expect(
      capabilityFor({
        ownerId: OWNER,
        actor: { ...agent("stranger"), capabilityCap: "editor" },
        memberCapability: null,
        guestCapability: null,
      })
    ).toBeNull();
  });
});

describe("atLeast", () => {
  it("ranks capabilities (editor satisfies commenter, viewer doesn't)", () => {
    expect(atLeast("editor", "commenter")).toBe(true);
    expect(atLeast("owner", "editor")).toBe(true);
    expect(atLeast("viewer", "commenter")).toBe(false);
    expect(atLeast(null, "viewer")).toBe(false);
  });
});
