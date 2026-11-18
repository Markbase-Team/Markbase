import { describe, expect, it } from "vitest";
import type { CallResult } from "../src/integration/call";
import { mcpAuth, type McpAuthDeps } from "../src/integration/mcp-auth";

// The MCP server's keys: which one a tool call is sent with, and the sign-in a
// call starts when none works. An agent runs this server with nobody at a
// terminal, so "run `markbase login`" is not an answer it can act on.

const ok: CallResult = { ok: true, status: 200, body: "{}" };
const unauthorized: CallResult = { ok: false, status: 401, body: '{"error":"unauthorized"}' };

/** An API that accepts exactly these keys, and remembers what it was sent. */
function api(...accepted: string[]) {
  const sent: string[] = [];
  const send = async (key: string): Promise<CallResult> => {
    sent.push(key);
    return accepted.includes(key) ? ok : unauthorized;
  };
  return { sent, send };
}

/** A sign-in the test finishes by hand. */
function browser() {
  let started = 0;
  let approve: (key: string) => void = () => {};
  let refuse: (why: Error) => void = () => {};
  const signIn: McpAuthDeps["signIn"] = (opened) => {
    started++;
    opened("https://markbase.example/cli-auth?state=s");
    return new Promise<string>((resolve, reject) => {
      approve = resolve;
      refuse = reject;
    });
  };
  return { signIn, approve: (key: string) => approve(key), refuse: (why: string) => refuse(new Error(why)), started: () => started };
}

function setup(over: Partial<McpAuthDeps> & { saved?: string; env?: string } = {}) {
  const b = browser();
  let saved = over.saved ?? "";
  const auth = mcpAuth({
    environmentKey: () => over.env ?? "",
    savedKey: () => saved,
    canSignIn: () => true,
    signIn: b.signIn,
    waitMs: 20,
    ...over,
  });
  return { auth, b, save: (key: string) => (saved = key) };
}

describe("mcpAuth", () => {
  it("sends the saved key and opens nothing when it works", async () => {
    const { auth, b } = setup({ saved: "jsk_saved" });
    const { sent, send } = api("jsk_saved");
    expect(await auth.call(send)).toBe(ok);
    expect(sent).toEqual(["jsk_saved"]);
    expect(b.started()).toBe(0);
  });

  it("falls back to the saved key when the config's key is refused, and stops trying the refused one", async () => {
    const { auth } = setup({ env: "jsk_revoked", saved: "jsk_saved" });
    const { sent, send } = api("jsk_saved");
    expect(await auth.call(send)).toBe(ok);
    expect(await auth.call(send)).toBe(ok);
    expect(sent).toEqual(["jsk_revoked", "jsk_saved", "jsk_saved"]);
    expect(auth.key()).toBe("jsk_saved");
  });

  it("signs in when there is no key, and sends the call with the new one", async () => {
    const { auth, b } = setup({ waitMs: 5_000 });
    const { sent, send } = api("jsk_new");
    const calling = auth.call(send);
    await Promise.resolve();
    b.approve("jsk_new");
    expect(await calling).toBe(ok);
    expect(sent).toEqual(["jsk_new"]);
  });

  it("answers 'approve, then retry' when the person has not got there yet, and the retry goes through", async () => {
    const { auth, b, save } = setup();
    const { send } = api("jsk_new");
    const first = await auth.call(send);
    expect(first).toEqual({ needsSignIn: expect.stringContaining("https://markbase.example/cli-auth?state=s") });

    // A second call while the page is still open waits on the same sign-in.
    const second = await auth.call(send);
    expect("needsSignIn" in second).toBe(true);
    expect(b.started()).toBe(1);

    b.approve("jsk_new");
    save("jsk_new");
    expect(await auth.call(send)).toBe(ok);
    expect(b.started()).toBe(1);
  });

  it("signs in again when the key it had was revoked", async () => {
    const { auth, b } = setup({ saved: "jsk_revoked", waitMs: 5_000 });
    const { sent, send } = api("jsk_new");
    const calling = auth.call(send);
    await new Promise((r) => setTimeout(r, 0));
    b.approve("jsk_new");
    expect(await calling).toBe(ok);
    expect(sent).toEqual(["jsk_revoked", "jsk_new"]);
  });

  it("says why when the sign-in fails, and a later call starts a new one", async () => {
    const { auth, b } = setup({ waitMs: 5_000 });
    const { send } = api();
    const calling = auth.call(send);
    await Promise.resolve();
    b.refuse("Timed out waiting for browser authorization.");
    expect(await calling).toEqual({ needsSignIn: expect.stringContaining("Timed out waiting") });
    void auth.call(send);
    await Promise.resolve();
    expect(b.started()).toBe(2);
  });

  it("does not open a browser on a machine that has none, and says what to do instead", async () => {
    const { auth, b } = setup({ canSignIn: () => false });
    const out = await auth.call(api().send);
    expect(out).toEqual({ needsSignIn: expect.stringContaining("MARKBASE_API_KEY") });
    expect(b.started()).toBe(0);
  });

  it("passes on anything that is not a refused key", async () => {
    const { auth, b } = setup({ saved: "jsk_saved" });
    const notFound: CallResult = { ok: false, status: 404, body: "{}" };
    expect(await auth.call(async () => notFound)).toBe(notFound);
    expect(b.started()).toBe(0);
  });
});
