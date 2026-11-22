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
