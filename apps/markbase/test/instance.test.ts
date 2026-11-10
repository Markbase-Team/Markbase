import { describe, it, expect } from "vitest";
import { appUrlFlag, normalizeInstanceUrl } from "../src/instance";

// The parsing and the check of the instance's answer are shared with the desktop
// app and tested with @markbase/protocol (test/instance.test.ts there); this
// pins that the command still reaches them, and reads its own flag.

describe("normalizeInstanceUrl", () => {
  it("is the shared one", () => {
    expect(normalizeInstanceUrl("markbase.acme.internal/docs")).toBe("https://markbase.acme.internal");
  });
});

describe("appUrlFlag", () => {
  it("reads both spellings and ignores the rest", () => {
    expect(appUrlFlag(["--app-url", "https://a.b"])).toBe("https://a.b");
    expect(appUrlFlag(["--global", "--app-url=https://a.b"])).toBe("https://a.b");
    expect(appUrlFlag(["--global"])).toBeNull();
    expect(appUrlFlag(["--app-url"])).toBeNull();
  });
});
