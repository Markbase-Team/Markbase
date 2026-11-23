import { describe, expect, it } from "vitest";
import { EMBED_CODE_TTL_MS, openEmbedCode, sealCode, sealEmbedCode } from "../src/mcp-oauth";

// The hand-off that signs a card's frame in (docs/embed-proof.md). It carries
// a single-use magic-link token, so what is under test is that it opens only
// here, only unaltered, only for a minute, and only as what it is.

const SECRET = "test-secret-0123456789";
const GRANT = { tokenHash: "hash_abc", userId: "user_1", next: "/dashboard/documents/doc_1" };
const NOW = Date.parse("2026-11-22T20:00:00Z");

describe("the embed hand-off code", () => {
  it("opens to what was sealed, within the minute", () => {
    expect(openEmbedCode(sealEmbedCode(GRANT, SECRET, NOW), SECRET, NOW + EMBED_CODE_TTL_MS - 1)).toEqual(GRANT);
  });

  it("is refused after the minute", () => {
    expect(openEmbedCode(sealEmbedCode(GRANT, SECRET, NOW), SECRET, NOW + EMBED_CODE_TTL_MS + 1)).toBeNull();
  });

  it("is refused under another server's secret, or altered by one character", () => {
    const code = sealEmbedCode(GRANT, SECRET, NOW);
    expect(openEmbedCode(code, "another-secret-987654", NOW)).toBeNull();
    const flipped = code.slice(0, 40) + (code[40] === "A" ? "B" : "A") + code.slice(41);
    expect(openEmbedCode(flipped, SECRET, NOW)).toBeNull();
    expect(openEmbedCode("", SECRET, NOW)).toBeNull();
    expect(openEmbedCode(null, SECRET, NOW)).toBeNull();
  });

  it("is not interchangeable with an OAuth code sealed by the same server", () => {
    const oauth = sealCode({ token: "jsk_x", clientId: "mbc_x", redirectUri: "https://x.example/cb", challenge: "c".repeat(43) }, SECRET, NOW);
    expect(openEmbedCode(oauth, SECRET, NOW)).toBeNull();
  });
});
