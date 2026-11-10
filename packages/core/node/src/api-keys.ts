import { createHash, randomBytes } from "node:crypto";
import { supabase } from "@markbase/protocol/supabase";
import { isProvider, type Provider } from "@markbase/protocol/agent-sessions";
import type { KeyCapability } from "@markbase/protocol/auth";

export type ApiScope = "read" | "write";

// A key/agent's capability ceiling on docs (owner > editor > commenter >
// viewer). NULL means full owner (backward-compatible default). The type is
// protocol's, because the gate forwards the ceiling to features on the caller
// header and the reader there must agree with the column here.
export type ApiCapability = KeyCapability;

// Public metadata about a key — never includes the hash or the plaintext.
export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiScope[];
  last_used_at: string | null;
  created_at: string;
  /** The auth user this key belongs to; scopes everything the key can reach. */
  owner_id: string | null;
  /** Capability ceiling for this key/agent; null = full owner. */
  capability: ApiCapability | null;
  /** Which agent tool this connection came from (claude_code, codex, …). */
  provider: Provider;
  /** `claude --version` on the machine holding this key; null if not installed. */
  claude_version: string | null;
}

const META =
  "id, name, key_prefix, scopes, last_used_at, created_at, owner_id, capability, provider, claude_version";

function normalizeCapability(cap?: string | null): ApiCapability | null {
  const allowed: ApiCapability[] = ["owner", "editor", "commenter", "viewer"];
  const v = String(cap ?? "").trim().toLowerCase();
  return (allowed as string[]).includes(v) ? (v as ApiCapability) : null;
}
const TOKEN_PREFIX = "jsk_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeScopes(scopes?: string[]): ApiScope[] {
  const allowed: ApiScope[] = ["read", "write"];
  const picked = (scopes ?? allowed)
    .map((s) => String(s).trim().toLowerCase())
    .filter((s): s is ApiScope => (allowed as string[]).includes(s));
  return picked.length ? Array.from(new Set(picked)) : ["read", "write"];
}

export async function listApiKeys(ownerId: string): Promise<ApiKey[]> {
  const { data, error } = await supabase
    .from("api_keys")
    .select(META)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ApiKey[];
}

// Create a key. Returns the metadata plus the plaintext token, which is shown
// to the owner once and never stored (only its hash is).
export async function createApiKey(input: {
  name: string;
  scopes?: string[];
  ownerId: string;
  ownerEmail: string | null;
  /** Capability ceiling for this agent; omit/null = full owner. */
  capability?: string | null;
  /** Origin of this connection; defaults to 'unknown' (captured later at runtime). */
  provider?: Provider;
  /** `claude --version` as probed by the CLI on this machine, if present. */
  claudeVersion?: string | null;
  /**
   * Mint this key INERT, to be activated by `confirmApiKey` once the client says
   * it arrived. Opt-in, so a client that doesn't know to confirm still gets a
   * working key.
   *
   * For the device-auth flow: the key used to go live the moment the browser
   * reached the approve route, and was then redirected at a loopback that might
   * not be listening. Every abandoned attempt left a full-access credential in an
   * address bar. Unconfirmed keys authenticate nothing and are swept.
   */
  requiresConfirmation?: boolean;
}): Promise<{ apiKey: ApiKey; token: string }> {
  const token = TOKEN_PREFIX + randomBytes(24).toString("base64url");
  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      name: input.name,
      key_prefix: token.slice(0, 12),
      key_hash: hashToken(token),
      scopes: normalizeScopes(input.scopes),
      owner_id: input.ownerId,
      owner_email: input.ownerEmail,
      capability: normalizeCapability(input.capability),
      claude_version: input.claudeVersion?.trim() || null,
      // Explicit either way. Left to the column default this would be NULL, and
      // the sweep would delete every key half an hour after it was issued.
      confirmed_at: input.requiresConfirmation ? null : new Date().toISOString(),
      ...(isProvider(input.provider) ? { provider: input.provider } : {}),
    })
    .select(META)
    .single();
  if (error) throw error;
  return { apiKey: data as ApiKey, token };
}

/**
 * Activate a key its client has just received. Returns false if the token is
 * unknown or was already confirmed.
 *
 * This is the second half of mint-after-confirm, and the only operation allowed
 * to touch an unconfirmed key — everything else refuses to see it. Single-use by
 * construction (`confirmed_at is null` in the filter), so a replayed confirm is
 * a no-op rather than a way to resurrect a swept key.
 */
export async function confirmApiKey(token: string): Promise<boolean> {
  if (!token) return false;
  const { data, error } = await supabase
    .from("api_keys")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("key_hash", hashToken(token))
    .is("confirmed_at", null)
    .select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export async function deleteApiKey(id: string, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from("api_keys")
    .delete()
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
}

// Look up a key by its plaintext token. Returns the metadata if valid, else
// null. Best-effort updates last_used_at (never blocks the request).
export async function verifyApiKey(token: string): Promise<ApiKey | null> {
  if (!token) return null;
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    // Minted but never acknowledged by its client — it reached a closed loopback,
    // or a browser tab nobody came back to. It authenticates nothing until
    // confirmApiKey says it arrived, and the sweep removes it.
    .not("confirmed_at", "is", null)
    .eq("key_hash", hashToken(token))
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ApiKey & { key_hash: string };
  void supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(
      () => {},
      () => {}
    );
  // Return only public metadata — never the hash. owner_id identifies whose
  // data this key may reach (the worker + agent API scope by it).
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scopes: row.scopes,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    owner_id: row.owner_id,
    capability: normalizeCapability(row.capability),
    provider: isProvider(row.provider) ? row.provider : "unknown",
    claude_version: row.claude_version ?? null,
  };
}

// Record (or clear) a connection's Claude Code version. The worker reports it
// on its slow sweep through PATCH /api/v1/worker/claude-version, and the API
// — which already resolved the bearer token to this key — records it here, so
// installing or removing Claude Code after `markbase login` is picked up
// without re-auth. Owner-scoped like every other key write.
export async function setClaudeVersion(
  keyId: string,
  ownerId: string,
  version: string | null
): Promise<void> {
  const { error } = await supabase
    .from("api_keys")
    .update({ claude_version: version?.trim() || null })
    .eq("id", keyId)
    .eq("owner_id", ownerId);
  if (error) throw error;
}

// Does this user have Claude Code anywhere? True when any of their connections
// reports a version. Drives the Claude-Code-only feature gates (see features.ts).
export async function hasClaudeCode(ownerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("id")
    .eq("owner_id", ownerId)
    .not("claude_version", "is", null)
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
