import { supabase } from "@markbase/server/supabase";
import { EMBED_PATH, sealEmbedCode } from "@markbase/server/mcp-oauth";
import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";
import { EMBED_DOC_ID, embedEnabled, embedTarget } from "@/lib/embed";
import { instanceUrl } from "@/lib/instance-url";
import { oauthSecret } from "@/lib/mcp-oauth";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

/** What the card sends. */
interface SessionBody {
  doc?: string | null;
}

// POST /api/v1/me/embed/session { doc? } — a hand-off for a card that frames
// the app: the address of /embed with a code that signs the frame in as the
// key's owner, good for one minute and once (see @markbase/server/mcp-oauth).
//
// Only for a connector's key: the card calls it through the agent's app with
// the key the app holds, and the answer goes to the card, never to the model
// (the tool is listed for the card only). A browser session is refused — it
// has its own session already, and a page should not be able to mint one.
// Experiment: 404 unless the embed is switched on (@/lib/embed).
export async function POST(req: Request) {
  if (!embedEnabled()) return agentJson({ error: "Not found" }, 404);
  const auth = await authenticateAgent(req, "read");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  if (auth.via !== "api_key") return agentJson({ error: "A hand-off is for a connected agent's key." }, 403);

  let body: SessionBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (body.doc && !EMBED_DOC_ID.test(body.doc)) return agentJson({ error: "doc is not a document id" }, 400);

  const { data: owner, error: ownerError } = await supabase.auth.admin.getUserById(auth.ownerId);
  const email = owner?.user?.email;
  if (ownerError || !email) return agentJson({ error: "This account cannot be signed in to from a card." }, 409);
  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return agentJson({ error: "Could not prepare the sign-in." }, 500);

  const code = sealEmbedCode({ tokenHash, userId: auth.ownerId, next: embedTarget(body.doc) }, oauthSecret());
  // Never logged: the address signs someone in for as long as it lasts.
  return agentJson({ url: `${await instanceUrl()}${EMBED_PATH}?code=${encodeURIComponent(code)}` });
}
