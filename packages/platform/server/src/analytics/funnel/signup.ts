import { isFreshAccount } from "@markbase/shared/analytics/funnel/signup-source";
import type { FunnelSource } from "@markbase/shared/analytics/funnel/events";
import { recordFunnelEventOnce } from "./events-store";

// A new account, as a funnel event: called at each moment a browser can turn
// into an account (the sign-in callback, an email sign-up, an invite), beside
// the signup source. An older account signing in records nothing here.

export interface SignedInUser {
  id: string;
  created_at?: string | null;
  app_metadata?: { provider?: string | null } | null;
}

/** Whether it was recorded: only for a new account, and only once. */
export async function recordSignUp(user: SignedInUser, source: FunnelSource, now: Date = new Date()): Promise<boolean> {
  if (!isFreshAccount(user.created_at ?? null, now)) return false;
  const method = user.app_metadata?.provider?.trim() || "unknown";
  return recordFunnelEventOnce(user.id, { name: "account.sign_up", source, props: { method } });
}
