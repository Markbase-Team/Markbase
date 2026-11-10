import { afterEach, describe, it, expect } from "vitest";
import {
  fetchLatestCliVersion,
  isVersionBehind,
  parseSemver,
  MIN_SPAWN_WORKER_VERSION,
} from "../src/version";

describe("parseSemver", () => {
  it("parses a.b.c (ignoring prerelease/suffix)", () => {
    expect(parseSemver("0.7.5")).toEqual([0, 7, 5]);
    expect(parseSemver("1.2.3-beta.1")).toEqual([1, 2, 3]);
  });
  it("returns null for junk", () => {
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("latest")).toBeNull();
  });
});

describe("isVersionBehind", () => {
  it("flags an older worker (the 0.3.2 case)", () => {
    expect(isVersionBehind("0.3.2", MIN_SPAWN_WORKER_VERSION)).toBe(true);
    expect(isVersionBehind("0.7.4", "0.7.5")).toBe(true);
    expect(isVersionBehind("0.6.9", "0.7.0")).toBe(true);
  });
  it("is false when equal or newer", () => {
    expect(isVersionBehind("0.7.5", "0.7.5")).toBe(false);
    expect(isVersionBehind("0.7.6", "0.7.5")).toBe(false);
    expect(isVersionBehind("1.0.0", "0.7.5")).toBe(false);
  });
  it("never false-alarms on missing/unparseable input", () => {
    expect(isVersionBehind(null, "0.7.5")).toBe(false);
    expect(isVersionBehind(undefined, "0.7.5")).toBe(false);
    expect(isVersionBehind("dev", "0.7.5")).toBe(false);
  });
});

describe("fetchLatestCliVersion", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("reads the version off the registry's /latest document", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ version: "0.7.7" }), {
        status: 200,
      })) as typeof fetch;
    expect(await fetchLatestCliVersion()).toBe("0.7.7");
  });

  it("returns null when the registry is unreachable — never throws at the caller", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await fetchLatestCliVersion()).toBeNull();
  });

  it("returns null on a non-200, so an outage can't look like an upgrade", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 503 })) as typeof fetch;
    expect(await fetchLatestCliVersion()).toBeNull();
  });
});
