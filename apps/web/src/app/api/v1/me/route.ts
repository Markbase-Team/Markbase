import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";
import { ownerDisplayName } from "@markbase/docs/server";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// GET /api/v1/me — identify the caller. Returns the owner_id the credentials
// resolve to (the signed-in user, or the API key's owner). The worker calls
// this once with its API key to learn which owner's jobs it should claim, so it
// never has to know or forge an owner_id itself.
//
// It also answers WHICH caller, not just whose. An owner can have several
// runners — Claude Code and Codex on one laptop, plus a server — and each is a
// separate api_keys row carrying its own provider. Presence and sessions need
// to key on that connection rather than the owner, or two runners for one owner
// overwrite each other (public.workers is keyed owner_id, and claim_next_job
// upserts presence on every poll).
//
// The runner cannot look this up itself: it authenticates with a bearer token
// and talks to this API, not to the database. So the server, which already
// resolved the token, hands back what it found.
//
// Additive on purpose — `markbase init` and `markbase doctor` read only
// owner_id, and keep working untouched.
export async function GET(req: Request) {
  const auth = await authenticateAgent(req, "read");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);

  // An admin (cookie) session is a person in a browser, not a runner: there is
  // no connection behind it, and inventing one would give every browser tab an
  // identity that claims work.
  const connection =
    auth.via === "api_key"
      ? {
          connection_id: auth.key.id,
          connection_name: auth.key.name,
          provider: auth.key.provider,
        }
      : { connection_id: null, connection_name: null, provider: null };

  // The vault daemon holds a bearer token and nothing else, yet a file you edit
  // in Obsidian is YOUR edit and has to be recorded under your name. This
  // endpoint already resolved the token, so it answers who the owner is too.
  const owner_name = await ownerDisplayName(auth.ownerId);

  return agentJson({ owner_id: auth.ownerId, owner_name, via: auth.via, ...connection });
}
