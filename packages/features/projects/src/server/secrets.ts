import { supabase } from "@markbase/protocol/supabase";
import { decryptSecret, encryptSecret, maskPreview } from "./secrets-crypto";

// Non-sensitive metadata about a stored secret. The encrypted columns
// (ciphertext/iv/auth_tag) are NEVER selected into here, so they never leave
// the database except in the dedicated reveal path below.
export interface SecretMeta {
  id: string;
  project: string;
  name: string;
  description: string;
  preview: string;
  created_at: string;
  updated_at: string;
}

const META_COLS =
  "id, project, name, description, preview, created_at, updated_at";

// Every query runs on the server's service client and is scoped by owner_id
// in the query itself. The web shell used to reach this table through a
// cookie-bound client so RLS applied; a package has no cookie, and the gate
// in front of these routes has already resolved the owner — so ownership is
// the `.eq("owner_id", ownerId)` on each statement, which is what every
// other package's server layer relies on too. The encrypted columns never
// leave the database except through the two reveal paths below.

// Read + decrypt the named secrets for a project, returning name → plaintext for
// the names that exist. Service-role (owner already verified by the caller). The
// worker's /api/v1/projects/:slug/mcp endpoint uses this to resolve ${NAME}
// references in a project's MCP config. Callers MUST verify ownership first.
export async function revealProjectSecrets(
  project: string,
  ownerId: string,
  names: string[]
): Promise<Record<string, string>> {
  if (names.length === 0) return {};
  const { data, error } = await supabase
    .from("secrets")
    .select("name, ciphertext, iv, auth_tag")
    .eq("project", project)
    .eq("owner_id", ownerId)
    .in("name", names);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as {
    name: string;
    ciphertext: string;
    iv: string;
    auth_tag: string;
  }[]) {
    try {
      out[row.name] = decryptSecret({
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.auth_tag,
      });
    } catch {
      // skip anything that won't decrypt (e.g. key rotation)
    }
  }
  return out;
}

export async function listSecrets(
  project: string,
  ownerId: string
): Promise<SecretMeta[]> {
  const { data, error } = await supabase
    .from("secrets")
    .select(META_COLS)
    .eq("project", project)
    .eq("owner_id", ownerId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as SecretMeta[];
}

export async function createSecret(input: {
  project: string;
  name: string;
  description?: string;
  value: string;
  ownerId: string;
}): Promise<SecretMeta> {
  const enc = encryptSecret(input.value);
  const { data, error } = await supabase
    .from("secrets")
    .insert({
      project: input.project,
      name: input.name,
      description: input.description ?? "",
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      auth_tag: enc.authTag,
      preview: maskPreview(input.value),
      owner_id: input.ownerId,
    })
    .select(META_COLS)
    .single();
  if (error) throw error;
  return data as SecretMeta;
}

export async function updateSecret(
  id: string,
  input: { name?: string; description?: string; value?: string },
  ownerId: string
): Promise<SecretMeta | undefined> {
  const patch: {
    name?: string;
    description?: string;
    ciphertext?: string;
    iv?: string;
    auth_tag?: string;
    preview?: string;
    updated_at: string;
  } = { updated_at: new Date().toISOString() };

  if (typeof input.name === "string") patch.name = input.name;
  if (typeof input.description === "string") patch.description = input.description;
  // Re-encrypt only when a new value is supplied (rotation).
  if (typeof input.value === "string" && input.value.length > 0) {
    const enc = encryptSecret(input.value);
    patch.ciphertext = enc.ciphertext;
    patch.iv = enc.iv;
    patch.auth_tag = enc.authTag;
    patch.preview = maskPreview(input.value);
  }

  const { data, error } = await supabase
    .from("secrets")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .select(META_COLS)
    .maybeSingle();
  if (error) throw error;
  return (data ?? undefined) as SecretMeta | undefined;
}

export async function deleteSecret(id: string, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from("secrets")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}

// Decrypt and return the plaintext for a single secret. Only ever called from
// the auth-gated reveal route — never from list/get.
export async function revealSecret(
  id: string,
  ownerId: string
): Promise<string | undefined> {
  const { data, error } = await supabase
    .from("secrets")
    .select("ciphertext, iv, auth_tag")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return decryptSecret({
    ciphertext: data.ciphertext as string,
    iv: data.iv as string,
    authTag: data.auth_tag as string,
  });
}
