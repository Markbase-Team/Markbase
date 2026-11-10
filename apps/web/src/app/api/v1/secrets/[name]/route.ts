import { deleteVaultSecret, getVaultSecret } from "@markbase/protocol/vault";
import { agentJson, authenticateAgent, preflight } from "@/lib/agent-auth";

export const runtime = "nodejs";

export function OPTIONS() {
  return preflight();
}

// GET /api/v1/secrets/:name — the encrypted blob { name, salt, nonce,
// ciphertext }. The client decrypts it locally with the vault passphrase.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await authenticateAgent(req, "read");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);

  const { name } = await params;
  const blob = await getVaultSecret(name, auth.ownerId);
  if (!blob) return agentJson({ error: "Secret not found" }, 404);
  return agentJson(blob);
}

// DELETE /api/v1/secrets/:name — remove a stored secret.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const auth = await authenticateAgent(req, "write");
  if (!auth.ok) return agentJson({ error: auth.error }, auth.status);

  const { name } = await params;
  await deleteVaultSecret(name, auth.ownerId);
  return agentJson({ ok: true });
}
