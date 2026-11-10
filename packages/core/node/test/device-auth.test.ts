import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { awaitDeviceAuth, DeviceAuthCanceledError } from "../src/device-auth";

// Authorizing a device (roadmap C4). The device opens a loopback port and waits
// for the browser to redirect back with a freshly minted key.
//
// Driven against real servers rather than mocks: the whole thing IS an HTTP
// handshake — a loopback the browser posts to, and a confirm call back to the
// app — and a mock would only prove I can write a mock.

/** Stands in for the Markbase app: just the one endpoint the flow calls. */
function appServer(confirmStatus = 200): Promise<{ url: string; confirms: string[]; close: () => void }> {
  const confirms: string[] = [];
  const server: Server = createServer((req, res) => {
    if (req.url === "/api/v1/keys/confirm" && req.method === "POST") {
      confirms.push((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
      res.writeHead(confirmStatus).end();
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        confirms,
        close: () => server.close(),
      });
    });
  });
}

const servers: Array<() => void> = [];
afterEach(() => {
  for (const close of servers.splice(0)) close();
});

async function app(status = 200): Promise<{ url: string; confirms: string[] }> {
  const s = await appServer(status);
  servers.push(s.close);
  return { url: s.url, confirms: s.confirms };
}

/** Play the part of the browser: read the auth URL, redirect back to the callback. */
function browser(over: { key?: string; state?: string; session?: string } = {}) {
  return async (authUrl: string): Promise<void> => {
    const url = new URL(authUrl);
    const callback = url.searchParams.get("callback") as string;
    const state = over.state ?? (url.searchParams.get("state") as string);
    const key = over.key ?? "jsk_minted_for_this_device";
    const session = over.session ? `&session=${encodeURIComponent(over.session)}` : "";
    await fetch(`${callback}/?key=${encodeURIComponent(key)}&state=${encodeURIComponent(state)}${session}`);
  };
}

describe("awaitDeviceAuth", () => {
  it("resolves with the key the browser sends back", async () => {
    const { url } = await app();
    const { key, session } = await awaitDeviceAuth({ appUrl: url, open: browser() });
    expect(key).toBe("jsk_minted_for_this_device");
    expect(session).toBeNull(); // no session unless one comes back
  });

  it("sends the browser to /cli-auth with a callback and a state", async () => {
    const { url } = await app();
    let seen = "";
    await awaitDeviceAuth({
      appUrl: `${url}/`, // trailing slash must not double up
      open: (authUrl) => {
        seen = authUrl;
        void browser()(authUrl);
      },
    });
    const parsed = new URL(seen);
    expect(parsed.pathname).toBe("/cli-auth");
    expect(parsed.searchParams.get("callback")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(parsed.searchParams.get("state")).toBeTruthy();
  });

  // A loopback port is open to anything running on the machine. Without the state
  // check, any local process could hand us a key it controls — and we'd save it
  // and start syncing someone else's account.
  it("refuses a key that comes back with the wrong state", async () => {
    const { url } = await app();
    const attempt = awaitDeviceAuth({
      appUrl: url,
      open: browser({ state: "not-the-state-we-issued", key: "jsk_attacker" }),
      timeoutMs: 700,
    });
    await expect(attempt).rejects.toThrow(/timed out/i); // never resolves with the key
  });

  it("carries the Claude version when the device has one, and omits it otherwise", async () => {
    const { url } = await app();
    let withClaude = "";
    await awaitDeviceAuth({
      appUrl: url,
      claudeVersion: "1.2.3",
      open: (u) => { withClaude = u; void browser()(u); },
    });
    expect(new URL(withClaude).searchParams.get("claude")).toBe("1.2.3");

    let without = "";
    await awaitDeviceAuth({
      appUrl: url,
      open: (u) => { without = u; void browser()(u); },
    });
    expect(new URL(without).searchParams.has("claude")).toBe(false);
  });

  // The page reads desktop=1 as "a person signing into their own app": it says
  // Sign in and finishes by itself. Without it, a desktop sign-in that wanted no
  // window session got the CLI page — a capability picker and an Authorize button
  // nobody expected to have to press.
  it("asks for the desktop page when told this is the app, session or not", async () => {
    const { url } = await app();
    let seen = "";
    await awaitDeviceAuth({ appUrl: url, desktop: true, open: (u) => { seen = u; void browser()(u); } });
    expect(new URL(seen).searchParams.get("desktop")).toBe("1");
    let cli = "";
    await awaitDeviceAuth({ appUrl: url, open: (u) => { cli = u; void browser()(u); } });
    expect(new URL(cli).searchParams.get("desktop")).toBeNull();
  });

  it("gives up rather than waiting forever on a tab nobody approved", async () => {
    const { url } = await app();
    await expect(
      awaitDeviceAuth({ appUrl: url, open: () => {}, timeoutMs: 500 })
    ).rejects.toThrow(/timed out/i);
  });

  it("waits as long as it takes when told there is no backstop", async () => {
    const { url } = await app();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const ac = new AbortController();
      let opened: (authUrl: string) => void = () => {};
      const authUrl = new Promise<string>((resolve) => (opened = resolve));
      const attempt = awaitDeviceAuth({
        appUrl: url,
        open: opened,
        signal: ac.signal,
        timeoutMs: null,
      });
      // The loopback is up and the browser has been sent to it.
      expect(await authUrl).toMatch(/callback=/);
      // Long past the default backstop, and nothing has given up.
      vi.advanceTimersByTime(3 * 60 * 60_000);
      const outcome = await Promise.race([
        attempt.then(() => "settled", () => "settled"),
        Promise.resolve("still waiting"),
      ]);
      expect(outcome).toBe("still waiting");
      // The only way out is the signal.
      ac.abort();
      await expect(attempt).rejects.toBeInstanceOf(DeviceAuthCanceledError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("issues a different state each time, so one redirect can't be replayed", async () => {
    const { url } = await app();
    const states: string[] = [];
    const capture = (u: string) => { states.push(new URL(u).searchParams.get("state") as string); void browser()(u); };
    await awaitDeviceAuth({ appUrl: url, open: capture });
    await awaitDeviceAuth({ appUrl: url, open: capture });
    expect(states[0]).not.toBe(states[1]);
  });
});

// A sign-in ends because someone said so, not because a clock ran out. Every
// fixed budget was wrong for somebody — a browser sign-in has no predictable
// duration — and when one expired mid-flow the failure was indistinguishable
// from a bug: the redirect landed on a port nobody was listening on.
describe("cancelling", () => {
  it("stops the attempt when the signal aborts", async () => {
    const { url } = await app();
    const ac = new AbortController();
    const attempt = awaitDeviceAuth({ appUrl: url, open: () => {}, signal: ac.signal });
    ac.abort();
    await expect(attempt).rejects.toBeInstanceOf(DeviceAuthCanceledError);
  });

  it("distinguishes cancelling from failing, so a retry says nothing to the user", async () => {
    const { url } = await app();
    const ac = new AbortController();
    const attempt = awaitDeviceAuth({ appUrl: url, open: () => {}, signal: ac.signal });
    ac.abort();
    // Not a timeout and not an error worth a dialog — the caller checks the type.
    await expect(attempt).rejects.not.toThrow(/timed out/i);
  });

  it("opens no port at all when the signal is already aborted", async () => {
    const { url } = await app();
    let opened = false;
    await expect(
      awaitDeviceAuth({
        appUrl: url,
        open: () => { opened = true; },
        signal: AbortSignal.abort(),
      })
    ).rejects.toBeInstanceOf(DeviceAuthCanceledError);
    expect(opened).toBe(false); // never sent the user anywhere
  });

  it("frees the loopback port, so a superseding attempt can start immediately", async () => {
    const { url, confirms } = await app();
    const ac = new AbortController();
    const abandoned = awaitDeviceAuth({ appUrl: url, open: () => {}, signal: ac.signal });
    ac.abort();
    await expect(abandoned).rejects.toBeInstanceOf(DeviceAuthCanceledError);

    // The retry a person actually makes. It must not be blocked by the one they
    // walked away from.
    const { key } = await awaitDeviceAuth({ appUrl: url, open: browser({ key: "jsk_second_try" }) });
    expect(key).toBe("jsk_second_try");
    expect(confirms).toEqual(["jsk_second_try"]);
  });

  it("ignores an abort that arrives after the key did", async () => {
    const { url } = await app();
    const ac = new AbortController();
    const { key } = await awaitDeviceAuth({ appUrl: url, open: browser(), signal: ac.signal });
    ac.abort(); // e.g. the window closing right as sign-in completes
    expect(key).toBe("jsk_minted_for_this_device"); // already resolved; nothing to undo
  });
});

// The key is minted INERT and only becomes usable once we say it arrived. That
// is what makes an abandoned authorization harmless: a redirect that lands on a
// closed loopback leaves a dead key behind rather than a live full-access one in
// someone's address bar.
describe("mint-after-confirm", () => {
  it("asks for a key that starts inert", async () => {
    const { url } = await app();
    let seen = "";
    await awaitDeviceAuth({ appUrl: url, open: (u) => { seen = u; void browser()(u); } });
    expect(new URL(seen).searchParams.get("confirm")).toBe("1");
  });

  it("confirms the key it received, with that key as the bearer", async () => {
    const { url, confirms } = await app();
    const { key } = await awaitDeviceAuth({ appUrl: url, open: browser({ key: "jsk_the_new_one" }) });
    expect(key).toBe("jsk_the_new_one");
    expect(confirms).toEqual(["jsk_the_new_one"]); // exactly once, and it's the right token
  });

  it("does not confirm a key that failed the state check", async () => {
    const { url, confirms } = await app();
    await expect(
      awaitDeviceAuth({
        appUrl: url,
        open: browser({ state: "wrong", key: "jsk_attacker" }),
        timeoutMs: 600,
      })
    ).rejects.toThrow(/timed out/i);
    // Confirming here would ACTIVATE a key an attacker chose — the state guard
    // has to come first, and be the reason nothing is confirmed.
    expect(confirms).toEqual([]);
  });

  it("accepts a live key from a server too old to know about confirming", async () => {
    // 404 = the endpoint isn't there, so the key was never inert. Refusing it
    // would break every device pointed at an older deployment.
    const { url } = await app(404);
    const { key } = await awaitDeviceAuth({ appUrl: url, open: browser() });
    expect(key).toBe("jsk_minted_for_this_device");
  });

  it("fails the sign-in when the key cannot be activated", async () => {
    // Anything other than ok-or-404 means we hold a key that will be swept in
    // half an hour. Better to fail now, loudly, than to hand the daemon a
    // credential that starts 401ing later for no visible reason.
    const { url } = await app(500);
    await expect(
      awaitDeviceAuth({ appUrl: url, open: browser() })
    ).rejects.toThrow(/could not activate/i);
  });
});
