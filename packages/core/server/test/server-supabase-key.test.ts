import { afterEach, describe, expect, it, vi } from "vitest";
import { serverSupabaseKey } from "../src/supabase";

// A self-hosted instance sets the secret key under the name SELF-HOSTING.md
// documents; the hosted deployment set it under the older name. Both must
// resolve, or the document API silently runs with the publishable key and
// every locked table answers 42501 — which is how this was found.

const NAMES = ["SUPABASE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

function only(name: (typeof NAMES)[number] | null, value = "sb_secret_x"): void {
  for (const n of NAMES) vi.stubEnv(n, n === name ? value : "");
  // stubEnv("") leaves an empty string, which `??` would keep; mirror a real
  // environment where the name is absent.
  for (const n of NAMES) if (n !== name) delete process.env[n];
}

describe("serverSupabaseKey", () => {
  it("accepts the documented name, SUPABASE_SECRET_KEY", () => {
    only("SUPABASE_SECRET_KEY");
    expect(serverSupabaseKey()).toBe("sb_secret_x");
  });

  it("accepts the hosted deployment's name, SUPABASE_KEY", () => {
    only("SUPABASE_KEY");
    expect(serverSupabaseKey()).toBe("sb_secret_x");
  });

  it("accepts the legacy service-role JWT name", () => {
    only("SUPABASE_SERVICE_ROLE_KEY", "eyJ.legacy");
    expect(serverSupabaseKey()).toBe("eyJ.legacy");
  });

  it("prefers SUPABASE_KEY when several are set", () => {
    only("SUPABASE_KEY", "from-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "from-secret");
    expect(serverSupabaseKey()).toBe("from-key");
  });

  it("is undefined when none is set", () => {
    only(null);
    expect(serverSupabaseKey()).toBeUndefined();
  });
});
