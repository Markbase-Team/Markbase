import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { SIGNUP_SOURCE_COOKIE } from "@markbase/shared/analytics/funnel/signup-source";
import { recordSignupSource } from "@markbase/server/analytics/funnel/signup-source-store";
import { recordSignUp } from "@markbase/server/analytics/funnel/signup";
import { signupSource } from "@/lib/funnels";

export const runtime = "nodejs";

// POST /api/signup-source — "I just signed up; here is where I came from."
//
// The browser calls this after a sign-up that is signed in on the spot (an
// email sign-up with confirmation off, an invite-code join), since those never
// pass through /auth/callback, which records the same thing for OAuth. The
// source is the mb_source cookie; the account is the session cookie's. The
// cookie is cleared once read, recorded or not: a browser that later signs up
// a second account has a new first visit to report.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const jar = await cookies();
  const outcome = await recordSignupSource(user, jar.get(SIGNUP_SOURCE_COOKIE)?.value);
  // Where the person was headed says whether this account is for a connector.
  await recordSignUp(user, signupSource(new URL(req.url).searchParams.get("next")));
  jar.delete(SIGNUP_SOURCE_COOKIE);
  return NextResponse.json({ outcome });
}
