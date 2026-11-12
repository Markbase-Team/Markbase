import { describe, it, expect } from "vitest";
import { resolveName } from "../src/server/users";

// Whose name shows on a published page, a version, an invitation: the one the
// person chose in Settings, then the one their Google sign-in brought, then
// nothing (the caller says "Markbase" — never an email, on a public page).
describe("resolveName", () => {
  it("prefers the display name the person chose", () => {
    expect(resolveName({ display_name: "Jess", full_name: "Jessie Jia", name: "jj" })).toBe("Jess");
  });

  it("falls back to the sign-in's name", () => {
    expect(resolveName({ full_name: "Jessie Jia" })).toBe("Jessie Jia");
    expect(resolveName({ name: "jj" })).toBe("jj");
    expect(resolveName({ display_name: "   ", full_name: "Jessie Jia" })).toBe("Jessie Jia");
  });

  it("is null when the account has no name at all", () => {
    expect(resolveName({})).toBeNull();
    expect(resolveName(undefined)).toBeNull();
    expect(resolveName({ display_name: null, full_name: "" })).toBeNull();
  });
});
