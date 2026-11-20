import { NextResponse, type NextRequest } from "next/server";
import { callerFromHeaders } from "@markbase/protocol/auth";
import { parseProductEvent, type ProductEventBody } from "@markbase/protocol/product-events";
import { recordProductEvent } from "@/lib/product-events-server";

export const runtime = "nodejs";

// POST /api/v1/events — "this just happened in the app."
//
// The prefix is in the proxy's GUARDED list as `required`, so the gate has
// already named the caller, on a cookie or a key; the event is theirs. The
// body is { name, props }, and a name that is not on the list is refused.
export async function POST(req: NextRequest) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: ProductEventBody | null = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const event = parseProductEvent(body);
  if (!event) return NextResponse.json({ error: "Unknown event" }, { status: 400 });

  const recorded = await recordProductEvent(caller.ownerId, event);
  return NextResponse.json({ recorded }, { status: recorded ? 201 : 202 });
}
