import { describe, it, expect, vi, afterEach } from "vitest";
import {
  authProviders,
  parseAuthProviders,
  type SettingsFetch,
} from "@/lib/supabase/auth-providers";

// Whether "Continue with Google" is live on this instance. A self-hoster's
// Supabase project has Google only if they set up an OAuth client; the local
// Supabase CLI stack never does. The page asks GoTrue rather than letting the
// click fail with "Unsupported provider".

const URL_ = "http://10.0.0.168:54321";
const KEY = "sb_publishable_test";

function stub(body: string, status = 200): { fetch: SettingsFetch; calls: string[]; inits: RequestInit[] } {
  const calls: string[] = [];
  const inits: RequestInit[] = [];
  const fetch: SettingsFetch = async (url, init) => {
    calls.push(url);
    inits.push(init ?? {});
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls, inits };
}

afterEach(() => vi.unstubAllEnvs());

describe("parseAuthProviders", () => {
  it("reads google from the external map", () => {
    expect(parseAuthProviders({ external: { google: true } })).toEqual({ google: true });
    expect(parseAuthProviders({ external: { google: false } })).toEqual({ google: false });
  });

  it("treats a missing entry as off", () => {
    expect(parseAuthProviders({})).toEqual({ google: false });
    expect(parseAuthProviders({ external: {} })).toEqual({ google: false });
  });
});

describe("authProviders", () => {
  it("asks the project's GoTrue settings with the publishable key", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `${URL_}/`);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
    const s = stub(JSON.stringify({ external: { google: false, email: true } }));
    expect(await authProviders(s.fetch)).toEqual({ google: false });
    expect(s.calls).toEqual([`${URL_}/auth/v1/settings`]);
    expect(s.inits[0].headers).toEqual({ apikey: KEY });
  });

  it("says google is on when the project has it", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
    const s = stub(JSON.stringify({ external: { google: true } }));
    expect(await authProviders(s.fetch)).toEqual({ google: true });
  });

  it("assumes everything is on when the project cannot be asked", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
    expect(await authProviders(stub("nope", 502).fetch)).toEqual({ google: true });
    expect(await authProviders(stub("{not json", 200).fetch)).toEqual({ google: true });
    const down: SettingsFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await authProviders(down)).toEqual({ google: true });
  });

  it("assumes everything is on when no project is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const s = stub("{}");
    expect(await authProviders(s.fetch)).toEqual({ google: true });
    expect(s.calls).toEqual([]);
  });
});
