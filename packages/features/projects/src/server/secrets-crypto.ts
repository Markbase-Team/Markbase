import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM encryption for secret values. The key is read from the
// SECRETS_ENCRYPTION_KEY env var (server-only — NEVER prefixed NEXT_PUBLIC, so
// it is never shipped to the browser) and is never stored in the database.
// Because GCM is authenticated, decryption fails loudly if the ciphertext or
// auth tag is tampered with.

export interface EncryptedValue {
  ciphertext: string; // base64
  iv: string; // base64 (12-byte nonce)
  authTag: string; // base64 (16-byte GCM tag)
}

// Resolve the 32-byte key. Accepts a base64 (44-char) or hex (64-char) env
// value. Throws a clear error if missing/malformed so the API can surface a
// "not configured" message instead of leaking a stack trace.
function getKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "SECRETS_ENCRYPTION_KEY is not set. Generate one with " +
        "`openssl rand -base64 32` and add it to the environment."
    );
  }
  const key = Buffer.from(raw, /^[0-9a-fA-F]{64}$/.test(raw) ? "hex" : "base64");
  if (key.length !== 32) {
    throw new Error(
      "SECRETS_ENCRYPTION_KEY must decode to 32 bytes (use `openssl rand -base64 32`)."
    );
  }
  return key;
}

export function encryptSecret(plaintext: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(value: EncryptedValue): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(value.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

// Last 4 plaintext chars for a list preview, e.g. "••••aB12". Not sensitive.
export function maskPreview(plaintext: string): string {
  const last4 = plaintext.slice(-4);
  return last4 ? `••••${last4}` : "";
}

// True when the encryption key is configured — lets the UI show a friendly
// "configure SECRETS_ENCRYPTION_KEY" notice instead of failing on save.
export function isSecretsConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
