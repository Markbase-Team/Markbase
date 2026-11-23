import { describe, expect, it } from "vitest";
import { isProductEventName, parseProductEvent } from "../../../src/analytics/funnel/events";

describe("product events", () => {
  it("knows the connect-agent events and nothing else", () => {
    expect(isProductEventName("connect_agent.shown")).toBe(true);
    expect(isProductEventName("connect_agent.clicked")).toBe(true);
    expect(isProductEventName("connect_agent.dismissed")).toBe(true);
    expect(isProductEventName("anything.else")).toBe(false);
    expect(isProductEventName(null)).toBe(false);
  });

  it("parses a known event with its props", () => {
    expect(parseProductEvent({ name: "connect_agent.clicked", props: { agent: "claude-code", surface: "web" } })).toEqual({
      name: "connect_agent.clicked",
      props: { agent: "claude-code", surface: "web" },
    });
  });

  it("refuses an unknown name or a missing body", () => {
    expect(parseProductEvent({ name: "drop table", props: {} })).toBeNull();
    expect(parseProductEvent({})).toBeNull();
    expect(parseProductEvent(null)).toBeNull();
  });

  it("keeps only short string props, and at most eight", () => {
    const props: Record<string, string | number | boolean | null | object> = {
      count: 3,
      flag: true,
      nested: { a: "b" },
      none: null,
      long: "x".repeat(500),
    };
    for (let i = 0; i < 12; i++) props[`k${i}`] = "v";
    const event = parseProductEvent({ name: "connect_agent.shown", props });
    expect(event?.props.long).toHaveLength(128);
    expect(event?.props.count).toBeUndefined();
    expect(event?.props.nested).toBeUndefined();
    expect(Object.keys(event?.props ?? {})).toHaveLength(8);
  });

  it("treats props that are not an object as none", () => {
    expect(parseProductEvent({ name: "connect_agent.shown" })?.props).toEqual({});
  });
});
