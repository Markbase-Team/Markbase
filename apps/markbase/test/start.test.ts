import { describe, it, expect } from "vitest";
import { ticketsRequested } from "../src/start";

// `markbase start` syncs vaults; claiming tickets is opt-in. The worker is a
// polling loop, and on a hosted API an idle worker is a steady stream of
// billed requests — so nothing runs it unless someone asked.
describe("markbase start: tickets are opt-in", () => {
  it("runs no ticket worker by default", () => {
    expect(ticketsRequested([], {})).toBe(false);
  });
  it("runs it for --tickets", () => {
    expect(ticketsRequested(["--tickets"], {})).toBe(true);
  });
  it("runs it when the service environment says so", () => {
    expect(ticketsRequested([], { MARKBASE_TICKETS: "on" })).toBe(true);
  });
  it("--no-tickets wins over the environment", () => {
    expect(ticketsRequested(["--no-tickets"], { MARKBASE_TICKETS: "on" })).toBe(false);
  });
  it("ignores other flags and values", () => {
    expect(ticketsRequested(["--verbose"], { MARKBASE_TICKETS: "off" })).toBe(false);
  });
});
