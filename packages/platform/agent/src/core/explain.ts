/**
 * Turn a failure into something worth reading.
 *
 * What the CLI hands over is written for a terminal: "API Error: 500
 * {"type":"error","error":{"type":"server_error"…}}". Printed as-is in a chat
 * panel it is a wall of punctuation that answers none of the three questions a
 * person actually has — what happened, whose fault is it, and is it worth trying
 * again.
 *
 * The wordings matched here are the ones that have actually occurred, taken from
 * the transcripts rather than imagined: "Failed to authenticate. API Error: 403
 * Request not allowed", "API Error: Unable to connect to API (ECONNRESET)",
 * "API Error: Connection dropped (ECONNRESET)", "Credit balance is too low".
 *
 * Nothing is thrown away — the caller keeps the raw text and shows it on
 * request. This only decides what to lead with.
 */

export interface Explained {
  /** One line, in plain words. */
  title: string;
  /** What to do about it, when there is something. */
  hint: string | null;
  /**
   * Whether waiting and retrying is the answer. The difference between "Claude
   * is down" and "you are signed out" is the difference between waiting and
   * doing something, and a panel that cannot tell them apart is no help.
   */
  retryable: boolean;
}

const has = (text: string, ...needles: string[]): boolean =>
  needles.some((n) => text.includes(n));

export function explainFailure(raw: string): Explained {
  const text = raw.toLowerCase();

  // Ours, from the exit watcher — the CLI died without ending the run.
  if (has(text, "claude cli exited")) {
    return {
      title: "Claude stopped unexpectedly",
      hint: "The local Claude process ended mid-answer. Send the message again to start a new one.",
      retryable: true,
    };
  }

  if (has(text, "credit balance is too low", "credits_required")) {
    return {
      title: "This Claude account is out of credit",
      hint: "Top it up, or sign in as an account that has some.",
      retryable: false,
    };
  }

  // Before the generic 4xx check: these are 401/403 and they are NOT retryable,
  // which is the whole reason to separate them.
  if (has(text, "failed to authenticate", "request not allowed", "api error: 401", "api error: 403", "unauthorized")) {
    return {
      title: "Claude isn't signed in on this machine",
      hint: "Run `claude` in a terminal and sign in, then try again.",
      retryable: false,
    };
  }

  if (has(text, "rate limit", "api error: 429", "too many requests")) {
    return {
      title: "Rate limited",
      hint: "Too many requests in a row. It clears on its own — give it a minute.",
      retryable: true,
    };
  }

  // Anything that could not reach the API at all: no answer means nothing was
  // charged and nothing was half-done, so retrying is safe.
  if (
    has(
      text,
      "econnreset",
      "unable to connect",
      "connection dropped",
      // "API Error: Connection closed mid-response. The response above may be
      // incomplete." — seen in the wild, and it was falling through to the
      // unrecognised branch, where it got quoted at full length as a headline.
      "connection closed",
      "etimedout",
      "enotfound",
      "fetch failed",
      "socket hang up",
      "network"
    )
  ) {
    return {
      title: "Couldn't reach Claude",
      hint: "The connection dropped before an answer came back. Check the network, then send it again.",
      retryable: true,
    };
  }

  // The API answered, and the answer was that it is having a bad time. This is
  // the `server_error` / `overloaded_error` family.
  if (has(text, "server_error", "overloaded", "api error: 5", "internal server error", "service unavailable", "bad gateway")) {
    return {
      title: "Claude is having trouble right now",
      hint: "The API returned an error of its own. Nothing is wrong on this machine — try again in a moment.",
      retryable: true,
    };
  }

  // A 4xx that is none of the above: the request itself was refused, so sending
  // the same thing again will be refused the same way.
  if (has(text, "api error: 4")) {
    return {
      title: "Claude refused the request",
      hint: null,
      retryable: false,
    };
  }

  // Unrecognised. The raw text IS the message — better an honest quote than a
  // reassuring guess about something we have not seen before.
  return { title: firstLine(raw), hint: null, retryable: true };
}

/** Enough of an unrecognised error to read at a glance. */
function firstLine(raw: string): string {
  const line = raw.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return "The agent run failed";
  return line.length > 140 ? `${line.slice(0, 140)}…` : line;
}
