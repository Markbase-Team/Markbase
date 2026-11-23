import { describe, expect, it } from "vitest";
import { EMBED_COOKIE_OPTIONS, EMBED_MARKER_COOKIE, serverEmbedCookieOptions } from "../src/embed-cookies";

// The server writes embed cookies (SameSite=None; Secure; Partitioned) only for
// a request from a frame /embed signed in — the marker beside its session says
// so — or under the local proof's flag. Everyone else keeps the defaults.

const jar = (names: string[]) => ({
  get: (name: string) => (names.includes(name) ? { value: "1" } : undefined),
});

describe("serverEmbedCookieOptions", () => {
  it("leaves an ordinary request with the default cookies", () => {
    expect(serverEmbedCookieOptions(undefined, jar(["sb-x-auth-token"]))).toBeUndefined();
    expect(serverEmbedCookieOptions(undefined)).toBeUndefined();
  });

  it("writes embed cookies for a request from a signed-in frame", () => {
    expect(serverEmbedCookieOptions(undefined, jar([EMBED_MARKER_COOKIE]))).toEqual(EMBED_COOKIE_OPTIONS);
  });

  it("writes embed cookies for everything under the local proof's flag", () => {
    expect(serverEmbedCookieOptions("1")).toEqual({ sameSite: "none", secure: true, partitioned: true });
  });
});
