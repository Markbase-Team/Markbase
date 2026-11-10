import { supabase } from "./supabase";

// An encrypted secret. The server only ever sees these ciphertext blobs — the
// vault passphrase and the plaintext value live on the client. See
// 20260612_vault_secrets.sql.
export interface VaultSecret {
  id: string;
  name: string;
  salt: string;
  nonce: string;
  ciphertext: string;
  created_at: string;
  updated_at: string;
}

export interface VaultBlob {
  salt: string;
  nonce: string;
  ciphertext: string;
}

// Valid secret names: env-var-like identifiers (e.g. OPENAI_API_KEY).
export const VAULT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function listVaultSecretNames(
  ownerId: string
): Promise<{ name: string; updated_at: string }[]> {
  const { data, error } = await supabase
    .from("vault_secrets")
    .select("name, updated_at")
    .eq("owner_id", ownerId)
    .order("name");
  if (error) throw error;
  return (data ?? []) as { name: string; updated_at: string }[];
}

// The encrypted blob for one secret. Returns null if unknown.
export async function getVaultSecret(
  name: string,
  ownerId: string
): Promise<(VaultBlob & { name: string }) | null> {
  const { data, error } = await supabase
    .from("vault_secrets")
    .select("name, salt, nonce, ciphertext")
    .eq("owner_id", ownerId)
    .ilike("name", name)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as VaultBlob & { name: string };
}

// Store (or replace) the ciphertext for a name. Never receives plaintext.
export async function upsertVaultSecret(input: {
  name: string;
  salt: string;
  nonce: string;
  ciphertext: string;
  ownerId: string;
}): Promise<{ name: string; updated_at: string }> {
  const existing = await supabase
    .from("vault_secrets")
    .select("id")
    .eq("owner_id", input.ownerId)
    .ilike("name", input.name)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) {
    const { data, error } = await supabase
      .from("vault_secrets")
      .update({
        salt: input.salt,
        nonce: input.nonce,
        ciphertext: input.ciphertext,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (existing.data as { id: string }).id)
      .eq("owner_id", input.ownerId)
      .select("name, updated_at")
      .single();
    if (error) throw error;
    return data as { name: string; updated_at: string };
  }

  const { data, error } = await supabase
    .from("vault_secrets")
    .insert({
      name: input.name,
      salt: input.salt,
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      owner_id: input.ownerId,
    })
    .select("name, updated_at")
    .single();
  if (error) throw error;
  return data as { name: string; updated_at: string };
}

export async function deleteVaultSecret(
  name: string,
  ownerId: string
): Promise<void> {
  const { error } = await supabase
    .from("vault_secrets")
    .delete()
    .eq("owner_id", ownerId)
    .ilike("name", name);
  if (error) throw error;
}
