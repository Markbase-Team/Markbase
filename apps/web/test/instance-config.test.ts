import { afterEach, describe, expect, it, vi } from "vitest";
import { serverInstanceConfig } from "@/lib/instance-info";
import { GET } from "@/app/api/v1/instance/route";

// The server tells every client which Supabase project it runs on — the root
// layout puts it in each page, GET /api/v1/instance answers it outright — and
// both read the server's environment through one function. A self-hosted image
// is built with no project and started with one, so that read has to be a read
// of the environment, and an instance without one has to say so.

const URL_ = "http://10.0.0.168:54321";
const KEY = "sb_publishable_test";

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.APP_URL;
});

describe("serverInstanceConfig", () => {
  it("reads the public pair from the environment", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
    expect(serverInstanceConfig()).toEqual({ supabaseUrl: URL_, supabasePublishableKey: KEY });
  });

  it("is null unless both halves are set", () => {
    expect(serverInstanceConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
    expect(serverInstanceConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(serverInstanceConfig()).toBeNull();
  });
});

describe("GET /api/v1/instance", () => {
  it("answers the project the server was started with", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", KEY);
    vi.stubEnv("APP_URL", "https://markbase.example.com/");
    const res = GET(new Request("https://markbase.example.com/api/v1/instance"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: "Markbase",
      app_url: "https://markbase.example.com",
      supabase_url: URL_,
      supabase_publishable_key: KEY,
    });
  });

  it("is a 503 on an instance with no project", async () => {
    const res = GET(new Request("http://localhost:3000/api/v1/instance"));
    expect(res.status).toBe(503);
  });
});
