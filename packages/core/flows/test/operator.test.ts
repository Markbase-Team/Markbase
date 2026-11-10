import { describe, it, expect, vi } from "vitest";
import {
  unattendedOperator,
  OperatorNeedsPersonError,
  type Operator,
} from "../src/operator";

// An Operator is whoever answers a question the flow cannot answer itself: a
// person at a dialog, a person at a terminal, or — on a server — nobody.
//
// The third case is the one worth testing hardest. A flow that stops to ask
// "which folder?" on a headless box will wait forever, and the failure looks
// like a hang rather than a question. So unattendedOperator answers what policy
// can answer, and throws where it cannot, loudly enough to name the question.

describe("unattendedOperator", () => {
  it("denies approvals by default, because nobody is watching", async () => {
    const op = unattendedOperator();
    await expect(
      op.approve({ action: 'Delete the local copy of "Blog"' })
    ).resolves.toBe(false);
  });

  it("approves when policy says to", async () => {
    const op = unattendedOperator({ approvals: "allow" });
    await expect(op.approve({ action: "Mount the vault" })).resolves.toBe(true);
  });

  it("names the question it could not answer, instead of hanging", async () => {
    const op = unattendedOperator();
    await expect(
      op.chooseFolder({ purpose: "Where should the vault live?" })
    ).rejects.toThrow(OperatorNeedsPersonError);
    await expect(
      op.chooseFolder({ purpose: "Where should the vault live?" })
    ).rejects.toThrow(/Where should the vault live\?/);
  });

  it("can answer a choice from policy, keyed by the question", async () => {
    const op = unattendedOperator({
      answers: { "Which vault?": "blog" },
    });
    await expect(
      op.chooseOption({
        question: "Which vault?",
        options: [
          { label: "Blog", value: "blog" },
          { label: "Stocks", value: "stocks" },
        ],
      })
    ).resolves.toBe("blog");
  });

  it("refuses a policy answer that is not one of the options", async () => {
    const op = unattendedOperator({ answers: { "Which vault?": "nope" } });
    await expect(
      op.chooseOption({
        question: "Which vault?",
        options: [{ label: "Blog", value: "blog" }],
      })
    ).rejects.toThrow(OperatorNeedsPersonError);
  });

  it("throws on an unanswerable choice rather than picking one", async () => {
    const op = unattendedOperator();
    await expect(
      op.chooseOption({
        question: "Which vault?",
        options: [
          { label: "Blog", value: "blog" },
          { label: "Stocks", value: "stocks" },
        ],
      })
    ).rejects.toThrow(/Which vault\?/);
  });

  it("writes what happened to the log it was given", () => {
    const log = vi.fn();
    const op = unattendedOperator({ log });
    op.reportEvent({ level: "warn", message: "That folder is inside another vault" });
    op.reportProgress({ task: "Blog", done: 3, total: 10 });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("That folder is inside another vault")
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Blog"));
  });

  it("satisfies the Operator interface", () => {
    const op: Operator = unattendedOperator();
    expect(typeof op.approve).toBe("function");
    expect(typeof op.chooseOption).toBe("function");
    expect(typeof op.chooseFolder).toBe("function");
    expect(typeof op.reportEvent).toBe("function");
    expect(typeof op.reportProgress).toBe("function");
  });
});
