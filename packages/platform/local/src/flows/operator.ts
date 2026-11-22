// Who answers a question the flow cannot answer itself.
//
// Mounting a vault, signing in and reconciling a folder are the same steps
// everywhere Markbase runs. The only thing that differs is who is asked and
// how: the desktop app asks with a dialog, the CLI asks on stdin, and a
// headless box has nobody to ask at all.
//
// That last case is why this exists as an interface rather than a pile of
// dialog calls. A flow that stops to ask "which folder?" on a server waits
// forever, and a hang tells whoever finds it nothing. So the unattended
// operator answers what policy can answer, and throws where it cannot — naming
// the question it could not answer.

export interface ApprovalRequest {
  /** The whole question, as a sentence: 'Delete the local copy of "Blog"'. */
  action: string;
  /** Why it is being asked, when that is not obvious from the action. */
  detail?: string;
  /** Label for the affirmative button, where there are buttons. */
  confirmLabel?: string;
}

export interface OptionRequest<T> {
  question: string;
  options: { label: string; value: T }[];
}

export interface FolderRequest {
  /** What the folder is for, phrased as the question to put to a person. */
  purpose: string;
  startAt?: string;
}

export interface OperatorEvent {
  level: "info" | "warn" | "error";
  message: string;
}

export interface OperatorProgress {
  /** What is progressing — a vault name, a file, a job. */
  task: string;
  done: number;
  total: number;
}

export interface Operator {
  /** May I do this thing that changes or destroys something? */
  approve(req: ApprovalRequest): Promise<boolean>;
  /** Which of these do you want? Values Markbase already knows about. */
  chooseOption<T>(req: OptionRequest<T>): Promise<T | null>;
  /** Where on disk? Asks the operating system, not a list. */
  chooseFolder(req: FolderRequest): Promise<string | null>;
  /** Here is what happened. No answer wanted. */
  reportEvent(e: OperatorEvent): void;
  /** Here is how far along the long-running thing is. */
  reportProgress(p: OperatorProgress): void;
}

/**
 * Thrown when a flow needs an answer only a person can give and there is no
 * person. Carries the question, so the log says what was being asked rather
 * than that something went wrong.
 */
export class OperatorNeedsPersonError extends Error {
  readonly question: string;

  constructor(question: string, why: string) {
    super(`No one is here to answer: ${question} — ${why}`);
    this.name = "OperatorNeedsPersonError";
    this.question = question;
  }
}

export interface UnattendedPolicy {
  /** What to do when asked for approval. Denies by default: nobody is watching. */
  approvals?: "allow" | "deny";
  /** Answers to specific questions, keyed by the question text. */
  answers?: Record<string, string>;
  /** Where to write what happened. Defaults to stderr, never to nowhere. */
  log?: (line: string) => void;
}

/**
 * The operator for a machine with nobody at it: a server, a CI runner, a
 * daemon under launchd. Answers from policy where policy has an answer, and
 * fails loudly where it does not.
 */
export function unattendedOperator(policy: UnattendedPolicy = {}): Operator {
  const {
    approvals = "deny",
    answers = {},
    log = (line: string) => console.error(line),
  } = policy;

  return {
    async approve(req: ApprovalRequest): Promise<boolean> {
      const allowed = approvals === "allow";
      log(
        `[operator] ${allowed ? "approved" : "denied"} by policy: ${req.action}`
      );
      return allowed;
    },

    async chooseOption<T>(req: OptionRequest<T>): Promise<T | null> {
      const wanted = answers[req.question];
      if (wanted === undefined) {
        throw new OperatorNeedsPersonError(
          req.question,
          "no answer is configured for it"
        );
      }
      // Compared as text because policy comes from a config file, where every
      // answer is a string, while the options carry real values.
      const picked = req.options.find((o) => String(o.value) === wanted);
      if (!picked) {
        throw new OperatorNeedsPersonError(
          req.question,
          `the configured answer "${wanted}" is not one of the options`
        );
      }
      return picked.value;
    },

    async chooseFolder(req: FolderRequest): Promise<string | null> {
      // Deliberately not answerable from policy: a path that does not exist, or
      // belongs to another vault, fails much later and much less clearly.
      throw new OperatorNeedsPersonError(
        req.purpose,
        "choosing a folder needs someone at a screen"
      );
    },

    reportEvent(e: OperatorEvent): void {
      log(`[${e.level}] ${e.message}`);
    },

    reportProgress(p: OperatorProgress): void {
      log(`[progress] ${p.task}: ${p.done}/${p.total}`);
    },
  };
}
