import { describe, expect, it } from "vitest";
import { CONNECTOR_DEFAULT_CAPABILITY, DEFAULT_CAPABILITY, pickedCapability } from "../src/lib/capabilities";

// A connector added inside an AI app is offered Owner by default, so sharing a
// document works from the chat; every other sign-in keeps Editor. The ceiling
// the person picks on the page always wins.

describe("the default access a connection is offered", () => {
  it("is Owner for a connector, and Editor for everything else", () => {
    expect(CONNECTOR_DEFAULT_CAPABILITY).toBe("owner");
    expect(DEFAULT_CAPABILITY).toBe("editor");
  });

  it("is what an approval falls back to when the form sends no choice it knows", () => {
    expect(pickedCapability(null, CONNECTOR_DEFAULT_CAPABILITY)).toBe("owner");
    expect(pickedCapability("admin", CONNECTOR_DEFAULT_CAPABILITY)).toBe("owner");
    expect(pickedCapability(null)).toBe("editor");
  });

  it("never overrides the access the person picked", () => {
    for (const picked of ["viewer", "commenter", "editor"] as const) {
      expect(pickedCapability(picked, CONNECTOR_DEFAULT_CAPABILITY)).toBe(picked);
    }
  });
});
