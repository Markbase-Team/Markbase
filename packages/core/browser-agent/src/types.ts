// Public types for the unsubscribe browser agent.

// The unsubscribe targets pulled from an email. Structurally identical to
// `UnsubscribeInfo` in @markbase/email so the route can pass it straight
// through — kept separate here to keep this package free of email deps.
export type UnsubscribeTarget = {
  // HTTPS endpoint from the List-Unsubscribe header.
  httpUrl: string | null;
  // mailto: target from the List-Unsubscribe header.
  mailto: string | null;
  // RFC 8058 one-click POST is supported on httpUrl.
  oneClick: boolean;
  // Unsubscribe link scraped from the body (fallback when no header).
  bodyUrl: string | null;
};

// How the unsubscribe was (or would be) carried out.
export type UnsubscribeMethod = "one-click" | "browser" | "mailto" | "none";

export type UnsubscribeResult = {
  // Did we confirm the unsubscribe went through?
  ok: boolean;
  method: UnsubscribeMethod;
  // Human-readable summary for the toast.
  message: string;
  // Where the browser agent ended up (browser method only).
  finalUrl?: string;
  // The agent's action log, surfaced for transparency.
  steps?: string[];
  // A page the user can open to finish by hand (when we couldn't confirm).
  manualUrl?: string;
  // mailto target, when that's the only option.
  mailto?: string;
};
