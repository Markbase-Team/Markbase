import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, type ApiTransport } from "../src/api-client";

// What the client must get right is which credential goes on a request — the
// rest is a fetch wrapper. `fetch` is stubbed because the assertions are about
// the request it builds, not about a server.

let calls: Array<[string, RequestInit]>;

function reply(body: unknown, status = 200, json = true) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!json) throw new SyntaxError("not json");
      return body;
    },
  } as Response;
}

beforeEach(() => {
  calls = [];
  // Back to the defaults a fresh web shell would have: no base, no provider.
  api.configureBaseUrl("");
  api.configureAuth(() => null);
  api.configureTransport(null);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return reply({ ok: true });
  }));
});

const sent = () => ({
  url: calls[0][0],
  init: calls[0][1],
  header: new Headers(calls[0][1].headers).get("authorization"),
});

describe("ApiClient — the shell injects the credential", () => {
  it("sends the cookie and no header when the shell configured nothing", async () => {
    await api.request("/api/v1/terms");

    expect(sent().header).toBeNull();
    expect(sent().init.credentials).toBe("include");
  });

  it("sends the header and NOT the cookie once a provider is configured", async () => {
    // The desktop case: its page is a browser (so a cookie could ride along)
    // and it holds a key. One request, one channel.
    api.configureAuth(() => "Bearer jsk_x");

    await api.request("/api/v1/terms");

    expect(sent().header).toBe("Bearer jsk_x");
    expect(sent().init.credentials).toBe("omit");
  });

  it("awaits a provider that has to go and fetch the token", async () => {
    // This is what makes a silent refresh possible.
    api.configureAuth(async () => "Bearer refreshed");

    await api.request("/api/v1/terms");

    expect(sent().header).toBe("Bearer refreshed");
  });

  it("prefixes the base url the shell gave it", async () => {
    api.configureBaseUrl("https://markbase.so/");

    await api.request("/api/v1/terms");

    expect(sent().url).toBe("https://markbase.so/api/v1/terms");
  });

  it("raises the server's own message when a call is refused", async () => {
    vi.mocked(fetch).mockResolvedValue(reply({ error: "This API key lacks the 'write' scope." }, 403));

    await expect(api.json("/api/v1/terms")).rejects.toThrow("lacks the 'write' scope");
  });

  it("raises the status when the refusal isn't JSON at all", async () => {
    // A proxy's HTML error page must not surface as "Unexpected token <".
    vi.mocked(fetch).mockResolvedValue(reply(null, 502, false));

    await expect(api.json("/api/v1/terms")).rejects.toThrow("HTTP 502");
  });
});

describe("ApiClient — the shell injects the transport", () => {
  it("hands the request to the transport instead of fetch, and returns its Response", async () => {
    // The desktop case: its pages may not fetch the API themselves, so the
    // shell carries each request elsewhere and brings a Response back.
    const seen: Parameters<ApiTransport>[0][] = [];
    api.configureTransport(async (req) => {
      seen.push(req);
      return new Response(JSON.stringify({ carried: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const body = await api.json<{ carried: boolean }>("/api/v1/terms", {
      method: "POST",
      body: JSON.stringify({ title: "x" }),
    });

    expect(body).toEqual({ carried: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].path).toBe("/api/v1/terms");
    expect(seen[0].body).toBe(JSON.stringify({ title: "x" }));
    expect(seen[0].headers.get("content-type")).toBe("application/json");
  });

  it("gives the transport the API path, not a URL — the transport knows where the API is", async () => {
    api.configureBaseUrl("https://markbase.so");
    let path = "";
    api.configureTransport(async (req) => {
      path = req.path;
      return new Response("{}");
    });

    await api.request("/api/v1/terms");

    expect(path).toBe("/api/v1/terms");
  });
});
