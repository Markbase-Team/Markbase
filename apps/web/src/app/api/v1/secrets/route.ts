import {
  listVaultSecretNames,
  upsertVaultSecret,
  VAULT_NAME_RE,
} from "@markbase/protocol/vault";
import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";

export const runtime = "nodejs";

// Base64 sanity bound so we never store unbounded junk (these are small blobs).
const MAX_B64 = 8192;
const isB64 = (s: unknown): s is string =>
  typeof s === "string" && s.length > 0 && s.length <= MAX_B64 && /^[A-Za-z0-9+/=]+$/.test(s);

export function OPTIONS() {
  return preflight();
}

// GET /api/v1/secrets — names + timestamps only (never ciphertext).
export async function GET(req: Request) {
  const auth = await authenticateAgent(req, "read");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);
  return agentJson({ secrets: await listVaultSecretNames(auth.ownerId) });
}

// POST /api/v1/secrets  { name, salt, nonce, ciphertext } — store an
// already-encrypted blob. The server never sees the passphrase or plaintext.
export async function POST(req: Request) {
  const auth = await authenticateAgent(req, "write");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);

  let body: { name?: string; salt?: string; nonce?: string; ciphertext?: string } = {};
  try {
    body = await req.json();
  } catch {
    return agentJson({ error: "Invalid JSON" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!VAULT_NAME_RE.test(name)) {
    return agentJson(
      { error: "name must be an identifier (letters, digits, underscore)" },
      400
    );
  }
  if (!isB64(body.salt) || !isB64(body.nonce) || !isB64(body.ciphertext)) {
    return agentJson(
      { error: "salt, nonce, ciphertext must be base64 (client-side encrypted)" },
      400
    );
  }

  const saved = await upsertVaultSecret({
    name,
    salt: body.salt,
    nonce: body.nonce,
    ciphertext: body.ciphertext,
    ownerId: auth.ownerId,
  });
  return agentJson({ secret: saved }, 201);
}
