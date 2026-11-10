import { describe, it, expect, vi } from "vitest";
import { terminalOperator } from "../src/terminal-operator";
import { OperatorNeedsPersonError } from "../src/operator";

// The CLI's operator: the same questions, asked on stdin.
//
// Input and output are injected so these tests drive it without touching the
// real terminal — and so `markbase` can point it at a pty, a test, or a pipe
// without the flows knowing the difference.

/** A scripted person: answers in order, and records what they were shown. */
function scripted(answers: string[]) {
  const shown: string[] = [];
  return {
    shown,
    ask: vi.fn(async (prompt: string) => {
      shown.push(prompt);
      return answers.shift() ?? "";
    }),
    write: vi.fn((line: string) => shown.push(line)),
  };
}

describe("terminalOperator", () => {
  it("treats a bare Enter as the safe answer: no", async () => {
    const p = scripted([""]);
    const op = terminalOperator({ ask: p.ask, write: p.write });
    await expect(op.approve({ action: "Delete the vault" })).resolves.toBe(false);
  });

  it("accepts y and yes, in any case", async () => {
    for (const answer of ["y", "Y", "yes", "YES"]) {
      const p = scripted([answer]);
      const op = terminalOperator({ ask: p.ask, write: p.write });
      await expect(op.approve({ action: "Mount it" })).resolves.toBe(true);
    }
  });

  it("puts the whole question to the person, not a bare y/n", async () => {
    const p = scripted(["n"]);
    const op = terminalOperator({ ask: p.ask, write: p.write });
    await op.approve({
      action: 'Delete the local copy of "Blog"',
      detail: "It was removed in the cloud",
    });
    const asked = p.shown.join("\n");
    expect(asked).toContain('Delete the local copy of "Blog"');
    expect(asked).toContain("It was removed in the cloud");
  });

  it("numbers the options and returns the one picked", async () => {
    const p = scripted(["2"]);
    const op = terminalOperator({ ask: p.ask, write: p.write });
    const picked = await op.chooseOption({
      question: "Which vault?",
      options: [
        { label: "Blog", value: "blog" },
        { label: "Stocks", value: "stocks" },
      ],
    });
    expect(picked).toBe("stocks");
    const shown = p.shown.join("\n");
    expect(shown).toContain("Which vault?");
    expect(shown).toContain("Blog");
    expect(shown).toContain("Stocks");
  });

  it("returns null when the person declines to choose", async () => {
    const p = scripted([""]);
    const op = terminalOperator({ ask: p.ask, write: p.write });
    await expect(
      op.chooseOption({
        question: "Which vault?",
        options: [{ label: "Blog", value: "blog" }],
      })
    ).resolves.toBeNull();
  });

  it("asks again when the number is not on the list", async () => {
    const p = scripted(["9", "1"]);
    const op = terminalOperator({ ask: p.ask, write: p.write });
    await expect(
      op.chooseOption({
        question: "Which vault?",
        options: [{ label: "Blog", value: "blog" }],
      })
    ).resolves.toBe("blog");
    expect(p.ask).toHaveBeenCalledTimes(2);
  });

  it("takes a typed path, trimmed, and expands a leading ~", async () => {
    const p = scripted(["  ~/Notes  "]);
    const op = terminalOperator({
      ask: p.ask,
      write: p.write,
      home: "/Users/test",
    });
    await expect(
      op.chooseFolder({ purpose: "Where should the vault live?" })
    ).resolves.toBe("/Users/test/Notes");
  });

  it("returns null when no path is typed and nothing was suggested", async () => {
    const p = scripted([""]);
    const op = terminalOperator({ ask: p.ask, write: p.write });
    await expect(
      op.chooseFolder({ purpose: "Where should the vault live?" })
    ).resolves.toBeNull();
  });

  it("takes the suggestion when there is one and the person just hits Enter", async () => {
    const p = scripted([""]);
    const op = terminalOperator({ ask: p.ask, write: p.write });
    // The suggestion is shown in the prompt, so Enter accepting it is what the
    // person was just told would happen. Without this the default is decoration.
    await expect(
      op.chooseFolder({
        purpose: "Where should the vault live?",
        startAt: "/Users/test/Blog",
      })
    ).resolves.toBe("/Users/test/Blog");
    expect(p.shown.join("\n")).toContain("/Users/test/Blog");
  });

  it("never throws OperatorNeedsPersonError — there is a person here", async () => {
    const p = scripted(["", ""]);
    const op = terminalOperator({ ask: p.ask, write: p.write });
    // Where the unattended operator gives up, this one just takes the answer,
    // including the answer "nothing".
    await expect(op.chooseFolder({ purpose: "Where?" })).resolves.toBeNull();
    await expect(op.approve({ action: "Anything" })).resolves.toBe(false);
  });

  it("writes events and progress where the person can see them", () => {
    const p = scripted([]);
    const op = terminalOperator({ ask: p.ask, write: p.write });
    op.reportEvent({ level: "error", message: "That folder is inside another vault" });
    op.reportProgress({ task: "Blog", done: 3, total: 10 });
    const out = p.shown.join("\n");
    expect(out).toContain("That folder is inside another vault");
    expect(out).toContain("Blog");
    expect(out).toContain("3");
  });
});
