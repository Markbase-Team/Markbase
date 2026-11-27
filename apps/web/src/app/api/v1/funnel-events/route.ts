import { NextResponse, type NextRequest } from "next/server";
import { callerFromHeaders } from "@markbase/shared/auth";
import { isDailyFunnelEvent, parseFunnelEvent, type FunnelEventBody } from "@markbase/shared/analytics/funnel/events";
import { recordFunnelEvent, recordFunnelEventDaily } from "@markbase/server/analytics/funnel/events-store";
import "@/lib/funnels";

export const runtime = "nodejs";

// POST /api/v1/funnel-events — "this just happened in the app, here."
//
// The prefix is in the proxy's GUARDED list as `required`, so the gate has
// already named the caller, on a cookie or a key; the event is theirs. The
// body is { name, source, props }: a name somebody declared (see
// @/lib/funnels) and one of the known sources, or it is refused.
export async function POST(req: NextRequest) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let body: FunnelEventBody | null = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const event = parseFunnelEvent(body);
  if (!event) return NextResponse.json({ error: "Unknown event or source" }, { status: 400 });
  // One kept once a day ("app.open") is reported on every load; today's first wins.
  const recorded = isDailyFunnelEvent(event.name)
    ? await recordFunnelEventDaily(caller.ownerId, event)
    : await recordFunnelEvent(caller.ownerId, event);
  return NextResponse.json({ recorded }, { status: recorded ? 201 : 202 });
}
