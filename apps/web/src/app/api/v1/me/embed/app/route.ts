import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";
import { EMBED_DOC_ID, embedEnabled } from "@/lib/embed";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// GET /api/v1/me/embed/app?doc=<id> — the tool an agent calls to show the
// person the real Markbase app, full page, in their conversation. It answers
// with what to open; the card the agent's app draws for it does the opening
// (a hand-off through POST /me/embed/session, then /embed in a frame).
// Experiment: 404 unless the embed is switched on (@/lib/embed).
export async function GET(req: Request) {
  if (!embedEnabled()) return agentJson({ error: "Not found" }, 404);
  const auth = await authenticateAgent(req, "read");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  const doc = new URL(req.url).searchParams.get("doc");
  if (doc && !EMBED_DOC_ID.test(doc)) return agentJson({ error: "doc is not a document id" }, 400);
  return agentJson({
    doc_id: doc,
    shown: "Markbase is open in the panel beside the conversation.",
  });
}
