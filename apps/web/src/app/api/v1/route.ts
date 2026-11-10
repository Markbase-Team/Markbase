import { agentJson, preflight } from "@/lib/agent-auth";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// GET /api/v1 — public discovery manifest so an agent can learn the API without
// a key. No project data is returned here.
export function GET(req: Request) {
  const base = new URL(req.url).origin;
  return agentJson({
    name: "Markbase agent API",
    version: "1",
    auth: "Send 'Authorization: Bearer <api_key>'. Create keys in the app's API Keys page.",
    scopes: ["read", "write"],
    endpoints: {
      instance: `GET ${base}/api/v1/instance  (public: the Supabase project behind this instance)`,
      list_skills: `GET ${base}/api/v1/skills`,
      get_skill: `GET ${base}/api/v1/skills/{name}  (add ?format=raw for the SKILL.md text)`,
      create_skill: `POST ${base}/api/v1/skills  { name, description, body }`,
      list_docs: `GET ${base}/api/v1/docs  (?vault=<id> | ?scope=shared; ?content=1 for the markdown)`,
      create_doc: `POST ${base}/api/v1/docs  { title?, content?, vault_id? }`,
      read_doc: `GET ${base}/api/v1/docs/{id}  (markdown, version, your capability)`,
      edit_doc: `POST ${base}/api/v1/docs/{id}/edits  { quote, insert }  (replace a passage)`,
      comment_on_doc: `POST ${base}/api/v1/docs/{id}/comments  { body, quotedText? }`,
      doc_history: `GET ${base}/api/v1/docs/{id}/history`,
      list_vaults: `GET ${base}/api/v1/vaults`,
      list_terms: `GET ${base}/api/v1/terms  (each term carries its Q&A thread)`,
      create_term: `POST ${base}/api/v1/terms  { term, definition? }`,
      delete_term: `DELETE ${base}/api/v1/terms/{id}`,
      ask_about_term: `POST ${base}/api/v1/terms/{id}/ask  { question }`,
      delete_term_message: `DELETE ${base}/api/v1/terms/messages/{id}`,
      list_learnings: `GET ${base}/api/v1/learnings`,
      create_learning: `POST ${base}/api/v1/learnings  { title?, content, entry_date? }`,
      update_learning: `PUT ${base}/api/v1/learnings/{id}  { title?, content?, entry_date? }`,
      delete_learning: `DELETE ${base}/api/v1/learnings/{id}`,
      list_secrets: `GET ${base}/api/v1/secrets  (names only)`,
      get_secret: `GET ${base}/api/v1/secrets/{name}  (encrypted blob; decrypt client-side)`,
      put_secret: `POST ${base}/api/v1/secrets  { name, salt, nonce, ciphertext }  (encrypt client-side first)`,
    },
    install_a_skill:
      "GET /api/v1/skills to list, then GET /api/v1/skills/{name}?format=raw and " +
      "write the response to ~/.claude/skills/{name}/SKILL.md (or .claude/skills/{name}/SKILL.md).",
  });
}
