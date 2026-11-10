import { agentJson, preflight } from "@/lib/agent-auth";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// GET /api/v1 — public discovery manifest so an agent can learn the API without
// a key. No project data is returned here.
//
// Only what every build serves: documents, vaults, secrets and the instance.
// It used to list the skills, terms and learnings endpoints too, which belong
// to feature packages the released build does not ship — the manifest
// advertised routes that answered 404.
export function GET(req: Request) {
  const base = new URL(req.url).origin;
  return agentJson({
    name: "Markbase agent API",
    version: "1",
    auth: "Send 'Authorization: Bearer <api_key>'. Create keys in the app's API Keys page.",
    scopes: ["read", "write"],
    endpoints: {
      instance: `GET ${base}/api/v1/instance  (public: the Supabase project behind this instance)`,
      list_docs: `GET ${base}/api/v1/docs  (?vault=<id> | ?scope=shared; ?content=1 for the markdown)`,
      create_doc: `POST ${base}/api/v1/docs  { title?, content?, vault_id? }`,
      read_doc: `GET ${base}/api/v1/docs/{id}  (markdown, version, your capability)`,
      edit_doc: `POST ${base}/api/v1/docs/{id}/edits  { quote, insert }  (replace a passage)`,
      comment_on_doc: `POST ${base}/api/v1/docs/{id}/comments  { body, quotedText? }`,
      doc_history: `GET ${base}/api/v1/docs/{id}/history`,
      list_vaults: `GET ${base}/api/v1/vaults`,
      list_secrets: `GET ${base}/api/v1/secrets  (names only)`,
      get_secret: `GET ${base}/api/v1/secrets/{name}  (encrypted blob; decrypt client-side)`,
      put_secret: `POST ${base}/api/v1/secrets  { name, salt, nonce, ciphertext }  (encrypt client-side first)`,
    },
  });
}
