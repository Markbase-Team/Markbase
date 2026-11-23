import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";
import { EMBED_DOC_ID, embedEnabled } from "@/lib/embed";
import { openPageUrl } from "@markbase/shared/instance";
import { instanceUrl } from "@/lib/instance-url";

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
  // Said as what may happen, not what did: an app that does not draw cards
  // shows nothing, and one that does may not allow the frame. The address is
  // always there to give the person.
  // Through /open: the desktop app when it is installed, the website otherwise.
  const url = openPageUrl(await instanceUrl(), doc);
  return agentJson({
    doc_id: doc,
    url,
    note:
      "Where the assistant's app shows Markbase cards, the document appears in one, with Open full page and Open in Markbase. " +
      "Do not tell the person it opened beside the conversation; offer this address to open it in Markbase.",
  });
}
