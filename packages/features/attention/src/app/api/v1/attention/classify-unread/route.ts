import { callerFromHeaders } from "@markbase/protocol/auth";
import { classifyUnreadEmails } from "../../../../../server";

// POST — classify every unread email across all connected accounts and link the
// results into Attention boards. Emails already linked to a board are skipped.
// The manifest gives this route `maxDuration: 300`; the sweep is slow.
export async function POST(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) {
    return Response.json({ error: "Missing credentials." }, { status: 401 });
  }

  try {
    const result = await classifyUnreadEmails();
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Classify failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
