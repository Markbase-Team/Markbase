import { NextResponse } from "next/server";
import { supabase } from "@markbase/protocol/supabase";

export const runtime = "nodejs";

// Very small, forgiving email shape check — the real guard is the unique index.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/subscribe  { email }  — store a landing "Stay in touch" signup.
// Re-submitting an existing address is a no-op success (idempotent).
export async function POST(req: Request) {
  let body: { email?: string; source?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source.slice(0, 40) : "landing";

  const { error } = await supabase.from("subscribers").insert({ email, source });

  // A duplicate hitting the lower(email) unique index reads as success too.
  if (error && error.code !== "23505") {
    return NextResponse.json({ error: "Couldn't save that — try again" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
