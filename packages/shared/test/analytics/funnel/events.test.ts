import { describe, expect, it } from "vitest";
import {
  cleanFunnelProps,
  declaredFunnelEvents,
  defineFunnelEvents,
  isFunnelEventName,
  isFunnelSource,
  parseFunnelEvent,
} from "../../../src/analytics/funnel/events";
import { appFunnel, signupSource } from "../../../src/analytics/funnel/onboarding";

// Funnel events: declared by whoever reports them, an action plus a source,
// and refused when nobody declared them.

describe("declaring funnel events", () => {
  it("knows what was declared, and by whom", () => {
    defineFunnelEvents("testfeature", ["widget.open", "widget.close"]);
    expect(isFunnelEventName("widget.open")).toBe(true);
    expect(isFunnelEventName("widget.missing")).toBe(false);
    expect(isFunnelEventName(null)).toBe(false);
    expect(declaredFunnelEvents()).toContainEqual({ name: "widget.close", owner: "testfeature" });
  });

  it("knows the app's own events", () => {
    for (const name of appFunnel.names) expect(isFunnelEventName(name)).toBe(true);
    expect(appFunnel.names).toEqual(["account.sign_up", "account.sign_in", "agent.connect", "vault.provision"]);
  });

  it("refuses a name declared by two owners, and a name that is not thing.action", () => {
    defineFunnelEvents("one", ["clash.event"]);
    expect(() => defineFunnelEvents("two", ["clash.event"])).toThrow(/both one and two/);
    // The same owner declaring again (a module loaded twice) is fine.
    expect(() => defineFunnelEvents("one", ["clash.event"])).not.toThrow();
    for (const bad of ["noDot", "Upper.case", "a.b.c", "account.sign-in"]) {
      expect(() => defineFunnelEvents("x", [bad]), bad).toThrow(/thing\.action/);
    }
  });
});

describe("parseFunnelEvent", () => {
  it("takes a declared action from a known source, with its props", () => {
    expect(parseFunnelEvent({ name: "account.sign_in", source: "desktop", props: { method: "email" } })).toEqual({
      name: "account.sign_in",
      source: "desktop",
      props: { method: "email" },
    });
  });

  it("refuses an undeclared name, an unknown source, or no body", () => {
    expect(parseFunnelEvent({ name: "account.teleport", source: "web" })).toBeNull();
    expect(parseFunnelEvent({ name: "account.sign_in", source: "dmg" })).toBeNull();
    expect(parseFunnelEvent({ name: "account.sign_in" })).toBeNull();
    expect(parseFunnelEvent(null)).toBeNull();
  });

  it("knows the four sources and nothing else", () => {
    expect(["web", "desktop", "cli", "mcp"].every((s) => isFunnelSource(s))).toBe(true);
    expect(isFunnelSource("phone")).toBe(false);
  });
});

describe("cleanFunnelProps", () => {
  it("keeps at most eight short strings", () => {
    const raw = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, "v"]));
    expect(Object.keys(cleanFunnelProps(raw))).toHaveLength(8);
    expect(cleanFunnelProps({ n: 3, ok: true, s: "x".repeat(300), ["k".repeat(41)]: "long key" })).toEqual({ s: "x".repeat(128) });
  });
});

describe("signupSource", () => {
  it("calls an account made on the way to a connector mcp, and the rest web", () => {
    expect(signupSource("/oauth/authorize?client_id=x")).toBe("mcp");
    expect(signupSource("/dashboard")).toBe("web");
    expect(signupSource(null)).toBe("web");
  });
});
