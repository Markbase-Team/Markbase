import { defineFunnelEvents } from "@markbase/shared/analytics/funnel/events";
import { defineFunnel } from "@markbase/shared/analytics/funnel/funnels";

// The documents feature's funnel events, and the funnels it owns. Each event
// is the action; where it happened (web, desktop) is its source.

export const docsFunnel = defineFunnelEvents("docs", [
  /** The "Connect an agent" modal opened after a first vault. */
  "connect_modal.show",
  /** A person pressed one of its agent buttons. props.agent names which. */
  "connect_modal.click",
  /** It closed. props.via: "not_now" for the button, "closed" otherwise. */
  "connect_modal.dismiss",
]);

/** Does the connect modal lead to a connection, the same day? */
export const connectModalFunnel = defineFunnel({
  id: "connect_modal",
  title: "Connect modal to a connected agent",
  subject: "account",
  windowDays: 1,
  steps: [
    { id: "shown", label: "Saw the connect modal", signals: [{ event: "connect_modal.show" }] },
    { id: "clicked", label: "Pressed an agent", signals: [{ event: "connect_modal.click" }] },
    {
      id: "connected",
      label: "Connected it",
      signals: [{ event: "agent.connect" }, { event: "account.sign_in", source: ["desktop", "cli"] }],
    },
  ],
});
