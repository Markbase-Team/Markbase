import { getWorkerPresence } from "@markbase/protocol";
import { callerFromHeaders } from "@markbase/protocol/auth";

// GET /api/v1/worker — is this owner's worker connected? Used by the
// dashboard to show a "worker not running" install card. "connected" means it
// polled claim_next_job within the staleness window (~15s).
export async function GET(req: Request) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const presence = await getWorkerPresence(caller.ownerId);
  return Response.json(presence);
}
