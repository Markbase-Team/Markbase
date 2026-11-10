import { revealSecret } from "../../../../../../server";
import { callerFromHeaders } from "@markbase/protocol/auth";

// POST /api/admin/secrets/:id/reveal — decrypt and return the plaintext value.
// POST (not GET) so the id/value never lands in URLs, server logs, or caches.
// The response is marked no-store for the same reason.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const caller = callerFromHeaders(req.headers);
  if (!caller) return Response.json({ error: "Missing credentials." }, { status: 401 });
  const { id } = await params;

  try {
    const value = await revealSecret(id, caller.ownerId);
    if (value === undefined) {
      return Response.json({ error: "Secret not found" }, { status: 404 });
    }
    return Response.json(
      { value },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reveal secret";
    return Response.json({ error: message }, { status: 500 });
  }
}
