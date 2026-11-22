import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CODE_TTL_MS,
  acceptableRedirect,
  checkAuthorize,
  openCode,
  pkceMatches,
  readClientId,
  redirectAllowed,
  registerClient,
  sealCode,
  signInChallenge,
} from "../src/mcp-oauth";

const SECRET = "test-secret";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

function registered(uris: string[] = [CLAUDE], name = "Claude") {
  const r = registerClient({ client_name: name, redirect_uris: uris }, SECRET);
  if (!r.ok) throw new Error(r.error_description);
  return r;
}

const VERIFIER = "a".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

describe("redirect addresses", () => {
  it("accepts https, http on this machine and an app's own scheme", () => {
    expect(acceptableRedirect(CLAUDE)).toBe(true);
    expect(acceptableRedirect("http://127.0.0.1:33418/callback")).toBe(true);
    expect(acceptableRedirect("http://localhost:6274/oauth/callback")).toBe(true);
    expect(acceptableRedirect("cursor://anysphere.cursor-mcp/oauth/callback")).toBe(true);
  });

  it("refuses plain http elsewhere and anything a browser would run", () => {
    expect(acceptableRedirect("http://example.com/cb")).toBe(false);
    expect(acceptableRedirect("javascript:alert(1)")).toBe(false);
    expect(acceptableRedirect("data:text/html,x")).toBe(false);
    expect(acceptableRedirect("https://example.com/cb#frag")).toBe(false);
    expect(acceptableRedirect("not a url")).toBe(false);
  });

  it("matches a registered address exactly, but lets a loopback port differ", () => {
    const web = registered().client;
    expect(redirectAllowed(web, CLAUDE)).toBe(true);
    expect(redirectAllowed(web, "https://claude.ai/api/mcp/auth_callback/x")).toBe(false);
    expect(redirectAllowed(web, "https://claude.ai.evil.example/api/mcp/auth_callback")).toBe(false);

    const local = registered(["http://127.0.0.1/callback"]).client;
    expect(redirectAllowed(local, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectAllowed(local, "http://127.0.0.1:51234/other")).toBe(false);
    expect(redirectAllowed(local, "http://localhost:51234/callback")).toBe(false);
  });
});

describe("client ids", () => {
  it("carry the registration and read back", () => {
    const { clientId } = registered([CLAUDE, "http://localhost/cb"], "Claude");
    expect(readClientId(clientId, SECRET)).toEqual({ name: "Claude", redirectUris: [CLAUDE, "http://localhost/cb"] });
  });

  it("are refused when altered, unsigned or signed by another server", () => {
    const { clientId } = registered();
    const [body] = clientId.slice(4).split(".");
    const forged = Buffer.from(JSON.stringify({ n: "Claude", r: ["https://evil.example/cb"] })).toString("base64url");
    expect(readClientId(clientId.replace(body, forged), SECRET)).toBeNull();
    expect(readClientId(`mbc_${forged}`, SECRET)).toBeNull();
    expect(readClientId(clientId, "another-secret")).toBeNull();
    expect(readClientId("claude", SECRET)).toBeNull();
    expect(readClientId(undefined, SECRET)).toBeNull();
  });

  it("refuse a registration with no usable redirect address", () => {
    expect(registerClient({ client_name: "x" }, SECRET)).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(registerClient({ redirect_uris: [] }, SECRET)).toMatchObject({ ok: false });
    expect(registerClient({ redirect_uris: ["http://example.com/cb"] }, SECRET)).toMatchObject({ ok: false });
  });

  it("give a client with no name one to show", () => {
    expect(registered([CLAUDE], "  ").client.name).toBe("An MCP client");
  });
});

describe("codes", () => {
  const grant = { token: "jsk_test", clientId: "mbc_x.y", redirectUri: CLAUDE, challenge: CHALLENGE };

  it("open to the grant they were sealed with", () => {
    expect(openCode(sealCode(grant, SECRET), SECRET)).toEqual(grant);
  });

  it("do not show the key", () => {
    expect(Buffer.from(sealCode(grant, SECRET), "base64url").toString("latin1")).not.toContain("jsk_test");
  });

  it("are refused once expired, altered or under another secret", () => {
    const code = sealCode(grant, SECRET, 1_000);
    expect(openCode(code, SECRET, 1_000 + CODE_TTL_MS)).toEqual(grant);
    expect(openCode(code, SECRET, 1_001 + CODE_TTL_MS)).toBeNull();
    const fresh = sealCode(grant, SECRET);
    expect(openCode(fresh.slice(0, -2) + (fresh.endsWith("AA") ? "BB" : "AA"), SECRET)).toBeNull();
    expect(openCode(fresh, "another-secret")).toBeNull();
    expect(openCode("", SECRET)).toBeNull();
    expect(openCode("garbage", SECRET)).toBeNull();
  });
});

describe("PKCE", () => {
  it("accepts the verifier the challenge was made from, and no other", () => {
    expect(pkceMatches(VERIFIER, CHALLENGE)).toBe(true);
    expect(pkceMatches("b".repeat(64), CHALLENGE)).toBe(false);
    expect(pkceMatches("short", CHALLENGE)).toBe(false);
    expect(pkceMatches(undefined, CHALLENGE)).toBe(false);
  });
});

describe("the authorize request", () => {
  const { clientId } = registered();
  const good = { response_type: "code", client_id: clientId, redirect_uri: CLAUDE, code_challenge: CHALLENGE, code_challenge_method: "S256" };

  it("passes when the client, its address and the proof are all there", () => {
    expect(checkAuthorize(good, SECRET)).toMatchObject({ ok: true, client: { name: "Claude" }, redirectUri: CLAUDE });
  });

  it("is refused for an unknown client, an unregistered address, or no S256 proof", () => {
    expect(checkAuthorize({ ...good, client_id: "nope" }, SECRET).ok).toBe(false);
    expect(checkAuthorize({ ...good, redirect_uri: "https://evil.example/cb" }, SECRET).ok).toBe(false);
    expect(checkAuthorize({ ...good, response_type: "token" }, SECRET).ok).toBe(false);
    expect(checkAuthorize({ ...good, code_challenge_method: "plain" }, SECRET).ok).toBe(false);
    expect(checkAuthorize({ ...good, code_challenge: undefined }, SECRET).ok).toBe(false);
  });
});

describe("the sign-in challenge", () => {
  it("points a client with no key at the resource metadata", () => {
    expect(signInChallenge("https://markbase.so")).toBe(
      'Bearer realm="Markbase", resource_metadata="https://markbase.so/.well-known/oauth-protected-resource/mcp"'
    );
    expect(signInChallenge("https://markbase.so", true)).toContain('error="invalid_token"');
  });
});
