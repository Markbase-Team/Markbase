import { confirmApiKey } from "@markbase/node/api-keys";
import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// POST /api/v1/keys/confirm — "the key reached me."
//
// The second half of mint-after-confirm. A key issued through the device-auth
// flow is inert until its client says it arrived, so an authorization that ends
// at a closed loopback leaves nothing usable behind.
//
// Deliberately NOT using `authenticateAgent`: that calls verifyApiKey, which
// refuses unconfirmed keys — the exact state this endpoint exists to leave. The
// bearer token IS the proof here. Holding it is what the confirmation attests
// to, and nothing else about the caller is trusted or needed.
export async function POST(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return agentJson({ error: "Missing bearer token" }, 401);

  // Unknown, already confirmed, or already swept — all reported the same way, so
  // this cannot be used to probe which tokens exist.
  const confirmed = await confirmApiKey(token);
  if (!confirmed) return agentJson({ error: "Not a pending key" }, 404);
  return agentJson({ ok: true });
}
