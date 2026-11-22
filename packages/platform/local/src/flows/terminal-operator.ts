import type {
  ApprovalRequest,
  FolderRequest,
  OperatorEvent,
  OperatorProgress,
  OptionRequest,
  Operator,
} from "./operator";

// The operator for someone at a terminal.
//
// Reading and writing are injected rather than imported: the CLI hands it
// readline, a test hands it a script, and one day a pty or a pipe could hand it
// something else. None of that reaches the flows, which only ever see an
// Operator.

export interface TerminalOperatorOptions {
  /** Put a prompt to the person and return what they typed. */
  ask: (prompt: string) => Promise<string>;
  /** Show a line. Separate from `ask` because most output asks nothing. */
  write: (line: string) => void;
  /** Where a leading "~" points. Injected so this stays testable. */
  home?: string;
}

function expandHome(input: string, home: string | undefined): string {
  if (!input.startsWith("~") || !home) return input;
  return input.replace(/^~/, home);
}

export function terminalOperator(opts: TerminalOperatorOptions): Operator {
  const { ask, write, home } = opts;

  return {
    async approve(req: ApprovalRequest): Promise<boolean> {
      // The action is a whole sentence, so the prompt reads as the question
      // rather than as a bare y/n nobody can interpret in a scrollback.
      const lines = [req.action];
      if (req.detail) lines.push(req.detail);
      const answer = (await ask(`${lines.join("\n")} [y/N]: `)).trim().toLowerCase();
      // Enter means no. Someone holding return through a prompt they did not
      // read should not thereby delete anything.
      return answer === "y" || answer === "yes";
    },

    async chooseOption<T>(req: OptionRequest<T>): Promise<T | null> {
      const menu = req.options
        .map((o, i) => `  ${i + 1}) ${o.label}`)
        .join("\n");
      // Loops rather than failing: a mistyped number is a slip, not a decision.
      for (;;) {
        const answer = (
          await ask(`${req.question}\n${menu}\nNumber (Enter to skip): `)
        ).trim();
        if (answer === "") return null;
        const index = Number(answer);
        const picked = req.options[index - 1];
        if (Number.isInteger(index) && picked) return picked.value;
        write(`Pick a number between 1 and ${req.options.length}.`);
      }
    },

    async chooseFolder(req: FolderRequest): Promise<string | null> {
      const suffix = req.startAt ? ` [${req.startAt}]` : "";
      const typed = (await ask(`${req.purpose}${suffix}\nPath (Enter to skip): `)).trim();
      if (typed === "") return req.startAt ?? null;
      return expandHome(typed, home);
    },

    reportEvent(e: OperatorEvent): void {
      write(e.level === "info" ? e.message : `${e.level}: ${e.message}`);
    },

    reportProgress(p: OperatorProgress): void {
      write(`${p.task}: ${p.done}/${p.total}`);
    },
  };
}
