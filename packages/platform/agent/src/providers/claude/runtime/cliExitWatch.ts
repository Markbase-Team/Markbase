// Notices when the Claude CLI dies without ending the run.
//
// A turn ends when the SDK's message stream ends. Usually the CLI exiting is
// what ends it — but not always: a run has been seen leaving the desktop app's
// spinner counting past five minutes with NO `claude` process anywhere on the
// machine, and no `gh` or shell under it either. The stream simply never
// returned, so the "end" the renderer waits for was never sent and the turn
// could only be cleared by hand.
//
// The process exiting IS the authoritative signal, which is why this watches
// for that rather than for silence: an inactivity timeout would have to guess a
// number, and guess it above the longest legitimate command the agent might run.
// Here there is nothing to guess. The one allowance is a grace period, because
// on a NORMAL turn the CLI also exits — a moment before the last of its output
// has been read — so death only counts once the stream has failed to end in the
// time it takes to drain a pipe.

/** The CLI died and the run never ended. Its own class so the host can tell it
 *  apart from a run that threw: this one has already produced a conversation the
 *  user can read, so it is reported as an error chunk on an otherwise clean end
 *  rather than as a fatal — losing the record of a chat that worked for several
 *  turns and only died on the last one would be the worse outcome. */
export class CliExitedError extends Error {
  constructor(
    message: string,
    readonly exit: ChildExit
  ) {
    super(message);
    this.name = "CliExitedError";
  }
}

export interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ExitWatch {
  /** Call when the CLI process exits. */
  noteExit(info: ChildExit): void;
  /**
   * Rejects once the CLI has died and the run still has not ended. Never
   * resolves — race it against the stream's next message.
   */
  readonly died: Promise<never>;
  /** The run ended (or threw); stop watching. */
  dispose(): void;
}

/** Long enough to drain what the CLI wrote on its way out, short enough that
 *  nobody sits watching a dead run. */
export const EXIT_GRACE_MS = 5_000;

export function describeExit({ code, signal }: ChildExit): string {
  if (signal) return `killed by ${signal}`;
  if (code === null) return "exit status unknown";
  return `exit code ${code}`;
}

export function watchForEarlyExit(options: {
  /**
   * Whether the user asked for this. Aborting kills the CLI, so abort produces
   * an exit too — and reporting the stop the user requested as a crash would be
   * the same mistake as the "[ede_diagnostic]" errors on every Esc.
   */
  aborted: () => boolean;
  graceMs?: number;
}): ExitWatch {
  const graceMs = options.graceMs ?? EXIT_GRACE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reject: ((error: Error) => void) | null = null;
  let done = false;

  const died = new Promise<never>((_resolve, rejectDied) => {
    reject = rejectDied;
  });
  // Mark it handled. Racing attaches its own handler, so this does not swallow
  // the rejection — it only stops Node reporting one when the run has already
  // moved on and nobody is racing any more.
  void died.catch(() => {});

  return {
    died,
    noteExit(info: ChildExit): void {
      if (done || timer) return;
      timer = setTimeout(() => {
        if (done || options.aborted()) return;
        reject?.(
          new CliExitedError(
            `The Claude CLI exited (${describeExit(info)}) without ending the run.`,
            info
          )
        );
      }, graceMs);
      // Do not hold the process open just to report a death.
      timer.unref?.();
    },
    dispose(): void {
      done = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
