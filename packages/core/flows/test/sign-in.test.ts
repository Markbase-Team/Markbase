import { describe, it, expect, vi } from "vitest";
import { signIn, type SignInDeps } from "../src/sign-in";
import { unattendedOperator, type Operator } from "../src/operator";

// Signing a machine in, written once.
//
// The desktop app and the CLI both do this, and both wrap the same
// awaitDeviceAuth: look for a key, and if there isn't one, open a browser,
// wait for it to come back, store what it hands over. What differs is the
// asking (a dialog against a console line) and what each does afterwards —
// the window needs a session, the CLI offers to install a skill.
//
// The case neither handles is a machine with no browser. Both open a loopback
// on localhost and wait for a redirect that, on a server, nobody can produce.
// The CLI half-admits it in an error path; here it is the designed answer.

function fakeOperator(answers: { approve?: boolean } = {}) {
  const asked = {
    approvals: [] as string[],
    events: [] as { level: string; message: string }[],
  };
  const op: Operator = {
    approve: vi.fn(async (r) => {
      asked.approvals.push(r.action);
      return answers.approve ?? true;
    }),
    chooseOption: vi.fn(async () => null),
    chooseFolder: vi.fn(async () => null),
    reportEvent: vi.fn((e) => asked.events.push({ level: e.level, message: e.message })),
    reportProgress: vi.fn(),
  };
  return { op, asked };
}

function deps(over: Partial<SignInDeps> = {}): SignInDeps {
  return {
    operator: fakeOperator().op,
    readKey: () => null,
    storeKey: vi.fn(),
    deviceAuth: vi.fn(async () => ({ key: "jsk_new", session: null })),
    canOpenBrowser: true,
    keyLocation: "~/.markbaseConfig/config.json",
    ...over,
  };
}

/** What awaitDeviceAuth throws when the person cancels rather than fails. */
function canceled(): Error {
  const e = new Error("Sign-in canceled.");
  e.name = "DeviceAuthCanceledError";
  return e;
}

describe("signIn", () => {
  it("uses the key this machine already has, and asks nobody anything", async () => {
    const { op } = fakeOperator();
    const d = deps({ readKey: () => "jsk_existing", operator: op });
    const res = await signIn(d);
    expect(res).toEqual({ ok: true, key: "jsk_existing", session: null, alreadyHadKey: true });
    expect(op.approve).not.toHaveBeenCalled();
    expect(d.deviceAuth).not.toHaveBeenCalled();
    expect(d.storeKey).not.toHaveBeenCalled();
  });

  it("asks before opening a browser", async () => {
    const { op, asked } = fakeOperator({ approve: true });
    await signIn(deps({ operator: op }));
    expect(asked.approvals[0]).toMatch(/sign in/i);
  });

  it("asks nothing when the person already chose, and goes straight to the browser", async () => {
    const { op } = fakeOperator({ approve: false }); // would decline, if asked
    const d = deps({ operator: op, question: null });
    const res = await signIn(d);
    expect(op.approve).not.toHaveBeenCalled();
    expect(d.deviceAuth).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it("does nothing when the person declines", async () => {
    const { op } = fakeOperator({ approve: false });
    const d = deps({ operator: op });
    const res = await signIn(d);
    expect(res).toEqual({ ok: false, reason: "declined" });
    expect(d.deviceAuth).not.toHaveBeenCalled();
    expect(d.storeKey).not.toHaveBeenCalled();
  });

  it("stores the key it was handed, and says where it went", async () => {
    const { op, asked } = fakeOperator();
    const d = deps({ operator: op });
    const res = await signIn(d);
    expect(res.ok).toBe(true);
    expect(d.storeKey).toHaveBeenCalledWith("jsk_new");
    expect(asked.events.map((e) => e.message).join(" ")).toContain(
      "~/.markbaseConfig/config.json"
    );
  });

  it("passes the session through for a host that has a window", async () => {
    const d = deps({
      wantSession: true,
      deviceAuth: vi.fn(async () => ({ key: "jsk_new", session: "tok_123" })),
    });
    const res = await signIn(d);
    expect(res).toEqual({
      ok: true,
      key: "jsk_new",
      session: "tok_123",
      alreadyHadKey: false,
    });
    expect(d.deviceAuth).toHaveBeenCalledWith(
      expect.objectContaining({ wantSession: true })
    );
  });

  it("treats cancelling as a decision, not a failure — and stays quiet", async () => {
    const { op, asked } = fakeOperator();
    const d = deps({
      operator: op,
      deviceAuth: vi.fn(async () => {
        throw canceled();
      }),
    });
    const res = await signIn(d);
    expect(res).toEqual({ ok: false, reason: "canceled" });
    expect(d.storeKey).not.toHaveBeenCalled();
    expect(asked.events.filter((e) => e.level === "error")).toEqual([]);
  });

  it("reports a real failure rather than leaving it in a log", async () => {
    const { op, asked } = fakeOperator();
    const d = deps({
      operator: op,
      deviceAuth: vi.fn(async () => {
        throw new Error("Could not activate the new key (500).");
      }),
    });
    const res = await signIn(d);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("failed");
      expect(res.message).toContain("500");
    }
    expect(asked.events.some((e) => e.level === "error")).toBe(true);
  });

  it("on a machine with no browser, says how to sign in instead of waiting", async () => {
    const { op, asked } = fakeOperator();
    const d = deps({ operator: op, canOpenBrowser: false });
    const res = await signIn(d);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-browser");
    // The loopback would never be reached from a server, so the flow must not
    // start one. The instruction is the product of this branch, not the log.
    expect(d.deviceAuth).not.toHaveBeenCalled();
    expect(asked.events.map((e) => e.message).join(" ")).toContain("MARKBASE_API_KEY");
  });

  it("an unattended machine with a key is signed in; without one it is told why", async () => {
    const withKey = await signIn(
      deps({
        operator: unattendedOperator({ log: () => {} }),
        readKey: () => "jsk_env",
      })
    );
    expect(withKey.ok).toBe(true);

    const without = await signIn(
      deps({
        operator: unattendedOperator({ log: () => {} }),
        canOpenBrowser: false,
      })
    );
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.reason).toBe("no-browser");
  });
});
