import { endAgentSession, renameAgentSession } from "@markbase/protocol";
import { callerFromHeaders } from "@markbase/protocol/auth";

// PATCH /api/v1/agent-sessions/:id  { name? | status:'ended' } — rename an
// agent session or end it (kept as history, not deleted).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;

  let body: { name?: string; status?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.status === "ended") {
    await endAgentSession(caller.ownerId, id);
    return Response.json({ ok: true });
  }
  if (typeof body.name === "string" && body.name.trim()) {
    const session = await renameAgentSession(caller.ownerId, id, body.name.trim());
    if (!session) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ session });
  }
  return Response.json({ error: "Nothing to update" }, { status: 400 });
}
