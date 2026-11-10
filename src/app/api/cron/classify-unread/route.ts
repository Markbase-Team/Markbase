import { classifyUnreadEmails } from "../../../../server";

// GET — invoked daily by the Vercel cron (see apps/web/vercel.json) to classify
// every unread email each morning. /api/cron is NOT behind the proxy's gate:
// Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron requests, and
// rejecting anything else is what keeps the endpoint off the public internet.
// The manifest gives this route `maxDuration: 300`.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await classifyUnreadEmails();
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Classify failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
