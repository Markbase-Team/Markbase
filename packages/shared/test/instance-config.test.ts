import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSTANCE_GLOBAL,
  findInstancePublicConfig,
  instanceConfigScript,
  instancePublicConfig,
} from "../src/instance-config";

// One built image serves any instance: the browser must take the Supabase
// project from what the server put in the page at request time, and only fall
// back to what the build was made with. Get the order wrong and every
// self-hosted instance started from the shared image talks to the project the
// image happened to be built against — or to none.

const RUNTIME = { supabaseUrl: "https://team.supabase.co", supabasePublishableKey: "sb_publishable_team" };
const BUILD = { url: "https://build.supabase.co", key: "sb_publishable_build" };

type Holder = { [INSTANCE_GLOBAL]?: { supabaseUrl?: string; supabasePublishableKey?: string } };
const holder = globalThis as Holder;

function buildEnv(url: string | null, key: string | null): void {
  if (url === null) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  if (key === null) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete holder[INSTANCE_GLOBAL];
});

describe("instancePublicConfig", () => {
  it("prefers the pair the server injected over the build's", () => {
    buildEnv(BUILD.url, BUILD.key);
    holder[INSTANCE_GLOBAL] = RUNTIME;
    expect(instancePublicConfig()).toEqual(RUNTIME);
  });

  it("falls back to the build's pair when the server injected nothing", () => {
    buildEnv(BUILD.url, BUILD.key);
    expect(instancePublicConfig()).toEqual({
      supabaseUrl: BUILD.url,
      supabasePublishableKey: BUILD.key,
    });
  });

  it("takes an incomplete injection as no injection", () => {
    buildEnv(BUILD.url, BUILD.key);
    holder[INSTANCE_GLOBAL] = { supabaseUrl: RUNTIME.supabaseUrl };
    expect(instancePublicConfig().supabasePublishableKey).toBe(BUILD.key);
    holder[INSTANCE_GLOBAL] = { supabaseUrl: "", supabasePublishableKey: "" };
    expect(instancePublicConfig().supabaseUrl).toBe(BUILD.url);
  });

  it("needs both halves from the build too", () => {
    buildEnv(BUILD.url, null);
    expect(findInstancePublicConfig()).toBeNull();
    buildEnv(BUILD.url, "");
    expect(findInstancePublicConfig()).toBeNull();
  });

  it("says where it looked when nothing is configured", () => {
    buildEnv(null, null);
    expect(findInstancePublicConfig()).toBeNull();
    expect(() => instancePublicConfig()).toThrow(/__MARKBASE_INSTANCE__.*NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("instanceConfigScript", () => {
  it("sets the global the reader looks at, and the reader finds it", () => {
    buildEnv(null, null);
    new Function(instanceConfigScript(RUNTIME))();
    expect(instancePublicConfig()).toEqual(RUNTIME);
  });

  it("cannot be broken out of by a value that contains a closing tag", () => {
    const script = instanceConfigScript({
      supabaseUrl: "https://x.supabase.co/</script><script>alert(1)",
      supabasePublishableKey: "k",
    });
    expect(script).not.toContain("</script>");
    expect(script).not.toContain("<");
    new Function(script)();
    expect(holder[INSTANCE_GLOBAL]?.supabaseUrl).toBe("https://x.supabase.co/</script><script>alert(1)");
  });
});
