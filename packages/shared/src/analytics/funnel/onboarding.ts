import { defineFunnelEvents } from "./events";
import { defineFunnel } from "./funnels";

// The app's own funnel events — actions no one feature owns — and the funnel
// that follows a new account to an agent that works with it. Each event is the
// action; where it happened (web, desktop, cli, mcp) is its source.

export const appFunnel = defineFunnelEvents(
  "app",
  [
  /** A new account. props.method: how it signed in ("google", "email"). Source "mcp" for one made on the way through a connector. */
  "account.sign_up",
  /** The account signed in: in the browser, the desktop app or the CLI. */
  "account.sign_in",
  /** An agent was given a key: through a connector ("mcp") or made in the dashboard ("web"). props.provider when known. */
  "agent.connect",
  /** The server made an account's first vault for it, because it signed up through a connector and never opened the app. */
  "vault.provision",
  /**
   * Someone opened the app: in the browser ("web"), the desktop app
   * ("desktop"), or inside an AI app's card ("mcp"). Kept once a day per
   * source, so it answers "came back on another day".
   */
  "app.open",
  ],
  { daily: ["app.open"] }
);

/** Where a new account came in, from where it was headed after signing in. */
export function signupSource(next: string | null | undefined): "web" | "mcp" {
  return next?.startsWith("/oauth/") ? "mcp" : "web";
}

export const onboardingFunnel = defineFunnel({
  id: "onboarding",
  title: "New account to an agent that works with it",
  subject: "account",
  windowDays: 14,
  steps: [
    { id: "signed_up", label: "Signed up", signals: [{ event: "account.sign_up" }] },
    {
      id: "has_vault",
      label: "Has a vault",
      signals: [{ action: "docs_createVault" }, { event: "vault.provision" }],
    },
    {
      id: "connected",
      label: "Connected an agent, the desktop app or the CLI",
      signals: [{ event: "agent.connect" }, { event: "account.sign_in", source: ["desktop", "cli"] }],
    },
    { id: "agent_worked", label: "An agent did something", signals: [{ action: "*", actor: "agent" }] },
    {
      id: "came_back",
      label: "Back a day later",
      signals: [{ event: "app.open" }, { event: "account.sign_in" }, { action: "*" }],
      atLeastHoursAfterStart: 24,
    },
  ],
});

/** Of the accounts that opened the app, who came back on another day, and after a week? */
export const returningFunnel = defineFunnel({
  id: "returning",
  title: "Opened the app, and came back",
  subject: "account",
  windowDays: 30,
  steps: [
    { id: "opened", label: "Opened the app", signals: [{ event: "app.open" }] },
    { id: "next_days", label: "Opened it again on a later day", signals: [{ event: "app.open" }], atLeastHoursAfterStart: 24 },
    { id: "after_a_week", label: "Opened it again a week or more later", signals: [{ event: "app.open" }], atLeastHoursAfterStart: 7 * 24 },
  ],
});
