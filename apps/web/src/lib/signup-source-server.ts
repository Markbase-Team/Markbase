import { supabase } from "@markbase/server/supabase";
import { isFreshAccount, parseSource } from "./signup-source";

// Where a sign-up came from — the server half. Copies the browser's source
// cookie (see ./signup-source) into public.signup_sources for an account that
// was just created. Both doors call it: the OAuth callback with the cookie it
// was handed, and POST /api/signup-source for a sign-up that never passes
// through the callback.

/** As much of the signed-in user as this needs; auth.users' row has both. */
export interface FreshUser {
  id: string;
  created_at?: string;
}

/** As much of the database client as this needs, so a test can hand in a stub. */
export interface SourceWriter {
  insert(row: SignupSourceRow): Promise<{ error: { code?: string; message: string } | null }>;
}

export interface SignupSourceRow {
  user_id: string;
  referrer: string | null;
  landing_path: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  first_seen_at: string;
}

const tableWriter: SourceWriter = {
  insert: async (row) => {
    const { error } = await supabase.from("signup_sources").insert(row);
    return { error };
  },
};

export type RecordOutcome = "recorded" | "no-cookie" | "not-new" | "already" | "failed";

/**
 * Record the cookie as this user's origin, once. Nothing happens for a sign-in
 * without the cookie, for an account older than the fresh window (a log-in, not
 * a sign-up), or when the row already exists; a database failure is reported,
 * never thrown — the account exists whether or not we know where it came from.
 */
export async function recordSignupSource(
  user: FreshUser,
  cookieValue: string | null | undefined,
  now: Date = new Date(),
  writer: SourceWriter = tableWriter
): Promise<RecordOutcome> {
  const source = parseSource(cookieValue);
  if (!source) return "no-cookie";
  if (!isFreshAccount(user.created_at, now)) return "not-new";
  const orNull = (v: string) => (v === "" ? null : v);
  const { error } = await writer.insert({
    user_id: user.id,
    referrer: orNull(source.referrer),
    landing_path: orNull(source.landing_path),
    utm_source: orNull(source.utm_source),
    utm_medium: orNull(source.utm_medium),
    utm_campaign: orNull(source.utm_campaign),
    utm_term: orNull(source.utm_term),
    utm_content: orNull(source.utm_content),
    first_seen_at: source.first_seen_at,
  });
  if (!error) return "recorded";
  // 23505: the primary key — a second sign-in inside the window. First wins.
  if (error.code === "23505") return "already";
  console.warn(`[signup-source] could not record ${user.id}: ${error.message}`);
  return "failed";
}
