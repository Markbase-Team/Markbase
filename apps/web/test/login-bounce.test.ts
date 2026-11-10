import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Bouncing a signed-in visitor off /login.
//
// The case that matters is the desktop sign-in, which reaches /login carrying
// `next=/cli-auth?callback=http://127.0.0.1:<port>…`. That query is not a
// preference about where to land — it is the rest of the sign-in, and the app
// is holding a loopback open waiting for it.

let signedIn = true;
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: signedIn ? { id: "u1", email: "her@example.com" } : null },
      }),
    },
  }),
}));

const { updateSession } = await import("@/lib/supabase/middleware");

const CLI_AUTH =
  "/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A51234%2F&state=abc&desktop=1";

function get(path: string) {
  return new NextRequest(`https://markbase.so${path}`);
}

/** Where the redirect points, as a path + query. */
function location(res: Response): string {
  const raw = res.headers.get("location") ?? "";
  const u = new URL(raw, "https://markbase.so");
  return u.pathname + u.search;
}

beforeEach(() => {
  signedIn = true;
});

describe("updateSession — the /login bounce keeps the destination", () => {
  it("carries next through, query string and all", async () => {
    const res = await updateSession(get(`/login?next=${encodeURIComponent(CLI_AUTH)}`));

    expect(res.status).toBe(307);
    expect(location(res)).toBe(CLI_AUTH);
  });

  it("still sends a bare visit to the dashboard", async () => {
    const res = await updateSession(get("/login"));

    expect(location(res)).toBe("/dashboard");
  });

  it("refuses an absolute next — that would be an open redirect", async () => {
    const res = await updateSession(
      get(`/login?next=${encodeURIComponent("https://evil.example/steal")}`)
    );

    expect(location(res)).toBe("/dashboard");
  });

  it("refuses a protocol-relative next for the same reason", async () => {
    const res = await updateSession(get("/login?next=%2F%2Fevil.example"));

    expect(location(res)).toBe("/dashboard");
  });

  it("leaves a signed-out visitor on the login page", async () => {
    signedIn = false;

    const res = await updateSession(get(`/login?next=${encodeURIComponent(CLI_AUTH)}`));

    expect(res.headers.get("location")).toBeNull();
  });
});
