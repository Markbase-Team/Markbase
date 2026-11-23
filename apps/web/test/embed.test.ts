import { afterEach, describe, expect, it } from "vitest";
import { claudeCardHost, embedEnabled, embedTarget } from "../src/lib/embed";

// The embed experiment's switch, and where a hand-off lands.

const before = process.env.MARKBASE_EMBED_FRAME_ANCESTORS;
afterEach(() => {
  if (before === undefined) delete process.env.MARKBASE_EMBED_FRAME_ANCESTORS;
  else process.env.MARKBASE_EMBED_FRAME_ANCESTORS = before;
});

describe("the embed", () => {
  it("is off unless the sites allowed to frame the app are named", () => {
    delete process.env.MARKBASE_EMBED_FRAME_ANCESTORS;
    expect(embedEnabled()).toBe(false);
    process.env.MARKBASE_EMBED_FRAME_ANCESTORS = "  ";
    expect(embedEnabled()).toBe(false);
    process.env.MARKBASE_EMBED_FRAME_ANCESTORS = "https://claude.ai https://*.claudemcpcontent.com";
    expect(embedEnabled()).toBe(true);
  });

  it("lands a hand-off on the document in embed mode, or the documents list for anything else", () => {
    expect(embedTarget("0746244f-86d5-4864-917e-714302a03e54")).toBe("/dashboard/documents/0746244f-86d5-4864-917e-714302a03e54?embed=1");
    expect(embedTarget(null)).toBe("/dashboard/documents?embed=1");
    expect(embedTarget("../settings")).toBe("/dashboard/documents?embed=1");
  });
});

describe("the card host Claude gives this server's cards", () => {
  it("is the first 32 hex of the SHA-256 of the server URL, under claudemcpcontent.com", () => {
    expect(claudeCardHost("https://markbase.so/mcp")).toBe("24fa4c91ecc164bc81314abf23f2cf7d.claudemcpcontent.com");
  });
});
