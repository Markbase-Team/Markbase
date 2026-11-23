// Sign-in for the hosted MCP server (/mcp): the OAuth 2.1 an MCP client runs
// when it is given a URL and no key. Claude's connectors and ChatGPT connect
// no other way.
//
// What it hands out is an ordinary API key. The person approves in the browser,
// as they do for `markbase login`, and the client receives a key of its own
// with the access they picked; every rule about keys (the capability ceiling,
// revoking one in the dashboard, attribution) applies unchanged, and a
// self-hosted instance has the whole flow with nothing to switch on.
//
// Nothing is stored for it:
//
//   a client id   is the client's registration itself, signed. Registering
//                 writes no row, and an id we did not sign is refused.
//   a code        is the key and what it was issued against, encrypted. The
//                 key inside is minted inert (see createApiKey) and comes
//                 alive when the code is exchanged, which works once; a code
//                 nobody exchanges leaves a key that authenticates nothing
//                 and is swept.
//
// This module is the parts with no HTTP in them. The routes are in
// apps/web/src/app/oauth.

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/** Where the hosted MCP server is served, on the instance's own address. */
export const MCP_PATH = "/mcp";
export const OAUTH_AUTHORIZE_PATH = "/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/oauth/token";
export const OAUTH_REGISTER_PATH = "/oauth/register";
/** RFC 9728: the document that says which server signs people in for /mcp. */
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

/** How long a code may wait to be exchanged. The exchange follows the redirect at once. */
export const CODE_TTL_MS = 2 * 60_000;

const CLIENT_PREFIX = "mbc_";
const MAX_REDIRECTS = 10;
const MAX_URI = 600;

/** A client as it registered itself. Both fields are its own word, checked for shape only. */
export interface OAuthClient {
  name: string;
  redirectUris: string[];
}

/** The fields of a registration request this server reads (RFC 7591). */
export interface RegistrationRequest {
  client_name?: string;
  redirect_uris?: string[];
}

/** What a code is issued against, and the key it releases. */
export interface CodeGrant {
  /** The inert API key the exchange activates and returns. */
  token: string;
  clientId: string;
  redirectUri: string;
  /** The PKCE challenge (S256) the exchange's verifier must hash to. */
  challenge: string;
}

/** An OAuth error, as its endpoint reports it. */
export interface OAuthError {
  error: string;
  error_description: string;
}

function derive(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "markbase-mcp-oauth", purpose, 32));
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}

/**
 * May a key be sent to this address at all? https anywhere; plain http only to
 * this machine; an app's own scheme (`cursor://…`), which only the app that
 * registered it with the operating system receives. Never a scheme a browser
 * would run or render itself.
 */
export function acceptableRedirect(uri: string): boolean {
  if (typeof uri !== "string" || uri.length > MAX_URI) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return isLoopback(url);
  return !["javascript:", "data:", "file:", "blob:", "about:", "vbscript:", "ws:", "wss:", "ftp:"].includes(url.protocol);
}

/**
 * Is this the address the client registered? An exact match, except that a
 * loopback address may differ in its port: a desktop client picks a free one
 * each time it signs in (RFC 8252 §7.3).
 */
export function redirectAllowed(client: OAuthClient, redirectUri: string): boolean {
  if (!acceptableRedirect(redirectUri)) return false;
  if (client.redirectUris.includes(redirectUri)) return true;
  const asked = new URL(redirectUri);
  if (!isLoopback(asked)) return false;
  return client.redirectUris.some((registered) => {
    const r = new URL(registered);
    return isLoopback(r) && r.hostname === asked.hostname && r.pathname === asked.pathname && r.search === asked.search;
  });
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", derive(secret, "client")).update(body).digest("base64url");
}

/** Register a client: check what it asks for and return the id that carries it. */
export function registerClient(
  request: RegistrationRequest,
  secret: string
): { ok: true; clientId: string; client: OAuthClient } | ({ ok: false } & OAuthError) {
  const uris = request.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECTS) {
    return { ok: false, error: "invalid_redirect_uri", error_description: `Give between 1 and ${MAX_REDIRECTS} redirect_uris.` };
  }
  const bad = uris.find((u) => !acceptableRedirect(u));
  if (bad !== undefined) {
    return {
      ok: false,
      error: "invalid_redirect_uri",
      error_description: "A redirect URI must be https, http on this machine, or an app's own scheme.",
    };
  }
  const named = typeof request.client_name === "string" ? request.client_name.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  const client: OAuthClient = { name: named.slice(0, 80) || "An MCP client", redirectUris: uris };
  const body = Buffer.from(JSON.stringify({ n: client.name, r: client.redirectUris }), "utf8").toString("base64url");
  return { ok: true, clientId: `${CLIENT_PREFIX}${body}.${sign(body, secret)}`, client };
}

/** The registration a client id carries, or null for one this server did not sign. */
export function readClientId(clientId: string | null | undefined, secret: string): OAuthClient | null {
  if (!clientId?.startsWith(CLIENT_PREFIX)) return null;
  const [body, signature, ...extra] = clientId.slice(CLIENT_PREFIX.length).split(".");
  if (!body || !signature || extra.length) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: { n?: string; r?: string[] } = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed.n !== "string" || !Array.isArray(parsed.r) || !parsed.r.every((u) => typeof u === "string")) return null;
    return { name: parsed.n, redirectUris: parsed.r };
  } catch {
    return null;
  }
}

/** Seal a grant into the code the client is redirected back with. */
export function sealCode(grant: CodeGrant, secret: string, now: number = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(secret, "code"), iv);
  const plain = JSON.stringify({ t: grant.token, c: grant.clientId, r: grant.redirectUri, p: grant.challenge, e: now + CODE_TTL_MS });
  const sealed = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url");
}

/** Open a code: the grant, or null for one that is not ours, was altered or has expired. */
export function openCode(code: string | null | undefined, secret: string, now: number = Date.now()): CodeGrant | null {
  if (!code) return null;
  try {
    const raw = Buffer.from(code, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", derive(secret, "code"), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const parsed: { t?: string; c?: string; r?: string; p?: string; e?: number } = JSON.parse(plain);
    const { t, c, r, p, e } = parsed;
    if (typeof t !== "string" || typeof c !== "string" || typeof r !== "string" || typeof p !== "string") return null;
    if (typeof e !== "number" || e < now) return null;
    return { token: t, clientId: c, redirectUri: r, challenge: p };
  } catch {
    return null;
  }
}

// ---- The embed hand-off ---------------------------------------------------
//
// A card in an AI app's conversation can show the real Markbase app, framed
// full page (docs/embed-proof.md). The frame has no session of its own — the
// person's markbase.so cookies are a different site's, and the browser does
// not send them there — so the card asks the server, with the connector's
// key, for a hand-off: the address of /embed with a code that signs the frame
// in. The code is a Supabase magic-link token (single use) sealed with the
// account and where to go, and it opens for one minute only.

/** Where a hand-off is redeemed. */
export const EMBED_PATH = "/embed";

/** How long a hand-off may wait to be redeemed. The card frames it at once. */
export const EMBED_CODE_TTL_MS = 60_000;

/** What a hand-off code carries. */
export interface EmbedGrant {
  /** The Supabase magic-link token hash: single use, it becomes the session. */
  tokenHash: string;
  /** The account it signs in, checked against the session it makes. */
  userId: string;
  /** Where in the app to land, a path on this instance. */
  next: string;
}

export function sealEmbedCode(grant: EmbedGrant, secret: string, now: number = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(secret, "embed"), iv);
  const plain = JSON.stringify({ h: grant.tokenHash, u: grant.userId, n: grant.next, e: now + EMBED_CODE_TTL_MS });
  const sealed = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString("base64url");
}

/** The grant, or null for a code that is not ours, was altered or has expired. */
export function openEmbedCode(code: string | null | undefined, secret: string, now: number = Date.now()): EmbedGrant | null {
  if (!code) return null;
  try {
    const raw = Buffer.from(code, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", derive(secret, "embed"), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const parsed: { h?: string; u?: string; n?: string; e?: number } = JSON.parse(plain);
    const { h, u, n, e } = parsed;
    if (typeof h !== "string" || typeof u !== "string" || typeof n !== "string") return null;
    if (typeof e !== "number" || e < now) return null;
    return { tokenHash: h, userId: u, next: n };
  } catch {
    return null;
  }
}

/** A PKCE challenge is 43 base64url characters: a SHA-256, unpadded. */
export function validChallenge(challenge: string | null | undefined): challenge is string {
  return typeof challenge === "string" && /^[A-Za-z0-9_-]{43}$/.test(challenge);
}

/** Does this verifier hash to the challenge the code was issued against (S256)? */
export function pkceMatches(verifier: string | null | undefined, challenge: string): boolean {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const hashed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const expected = Buffer.from(challenge);
  return hashed.length === expected.length && timingSafeEqual(hashed, expected);
}

/** The authorize request, as the query carries it. */
export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

/**
 * Check an authorize request. Every failure is shown to the person and never
 * sent to the redirect URI: until the client and its address are known to
 * match, that address is not one to send anybody to.
 */
export function checkAuthorize(
  params: AuthorizeParams,
  secret: string
): { ok: true; client: OAuthClient; clientId: string; redirectUri: string; challenge: string } | { ok: false; reason: string } {
  const client = readClientId(params.client_id, secret);
  if (!client || !params.client_id) return { ok: false, reason: "This app is not registered with this Markbase. Remove it in the app and add it again." };
  if (!params.redirect_uri || !redirectAllowed(client, params.redirect_uri)) {
    return { ok: false, reason: "The app asked to be sent somewhere it did not register." };
  }
  if (params.response_type !== "code") return { ok: false, reason: "The app asked for a kind of sign-in this Markbase does not offer." };
  if (params.code_challenge_method !== "S256" || !validChallenge(params.code_challenge)) {
    return { ok: false, reason: "The app did not send the proof (PKCE, S256) this Markbase requires." };
  }
  return { ok: true, client, clientId: params.client_id, redirectUri: params.redirect_uri, challenge: params.code_challenge };
}

/** RFC 9728: where /mcp is, and who signs people in for it. */
export function protectedResourceMetadata(issuer: string) {
  return {
    resource: `${issuer}${MCP_PATH}`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    resource_name: "Markbase",
  };
}

/** RFC 8414: this server's endpoints and what they support. */
export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}${OAUTH_AUTHORIZE_PATH}`,
    token_endpoint: `${issuer}${OAUTH_TOKEN_PATH}`,
    registration_endpoint: `${issuer}${OAUTH_REGISTER_PATH}`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  };
}

/** The `WWW-Authenticate` value that sends a client with no key to sign in. */
export function signInChallenge(issuer: string, invalid = false): string {
  const pointer = `resource_metadata="${issuer}${PROTECTED_RESOURCE_PATH}${MCP_PATH}"`;
  return `Bearer realm="Markbase", ${invalid ? 'error="invalid_token", ' : ""}${pointer}`;
}
