import { describe, expect, it } from "vitest";
import { defineFunnel, funnelById, listFunnels, type Funnel } from "../../../src/analytics/funnel/funnels";
import { onboardingFunnel, returningFunnel } from "../../../src/analytics/funnel/onboarding";

const steps: Funnel["steps"] = [
  { id: "a", label: "A", signals: [{ event: "x.a" }] },
  { id: "b", label: "B", signals: [{ action: "*" }] },
];

describe("defineFunnel", () => {
  it("registers a funnel so it can be found and listed", () => {
    const f = defineFunnel({ id: "test_ok", title: "T", subject: "account", windowDays: 3, steps });
    expect(funnelById("test_ok")).toBe(f);
    expect(listFunnels()).toContain(onboardingFunnel);
    expect(funnelById("returning")).toBe(returningFunnel);
  });

  it("refuses a funnel that is not one", () => {
    expect(() => defineFunnel({ id: "Bad-Id", title: "T", subject: "account", windowDays: 1, steps })).toThrow(/lower case/);
    expect(() => defineFunnel({ id: "one_step", title: "T", subject: "account", windowDays: 1, steps: steps.slice(0, 1) })).toThrow(/two steps/);
    expect(() =>
      defineFunnel({ id: "no_signal", title: "T", subject: "account", windowDays: 1, steps: [steps[0], { id: "b", label: "B", signals: [] }] })
    ).toThrow(/signal/);
    expect(() => defineFunnel({ id: "same_ids", title: "T", subject: "account", windowDays: 1, steps: [steps[0], steps[0]] })).toThrow(/one id/);
    defineFunnel({ id: "twice", title: "T", subject: "account", windowDays: 1, steps });
    expect(() => defineFunnel({ id: "twice", title: "Other", subject: "account", windowDays: 1, steps })).toThrow(/twice, differently/);
  });

  it("accepts the same declaration again, as a second copy of its module would make", () => {
    const declare = (): Funnel => defineFunnel({ id: "copied", title: "T", subject: "account", windowDays: 1, steps: [...steps] });
    declare();
    expect(() => declare()).not.toThrow();
  });
});
