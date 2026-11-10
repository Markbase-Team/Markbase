import { describe, it, expect } from "vitest";
import { connectToInstance, instanceStatus, type InstanceDeps } from "../src/instance";

// Changing the instance is the one setting that restarts the app and drops its
// key, so the order matters: nothing is written until the instance has answered,
// and the relaunch comes last. These drive the decision with fakes for the
// registry, the key and Electron.

const hosted = {
  appUrl: "https://markbase.so",
  supabaseUrl: "https://hosted.supabase.co",
  supabaseKey: "sb_publishable_hosted",
};
const acme = {
  appUrl: "https://markbase.acme.internal",
  supabaseUrl: "https://acme.supabase.co",
  supabaseKey: "sb_publishable_acme",
};

interface Fake extends InstanceDeps {
  events: string[];
  saved: InstanceDeps["current"] | null;
}

function fake(answer: (url: string) => Promise<{ status: number; body: object }>): Fake {
  const deps: Fake = {
    events: [],
    saved: null,
    current: hosted,
    save: async (instance) => {
      deps.saved = instance;
      deps.events.push("save");
    },
    forgetKey: () => void deps.events.push("forgetKey"),
    relaunch: () => void deps.events.push("relaunch"),
    log: () => {},
    fetchImpl: async (url) => {
      const { status, body } = await answer(url);
      return { ok: status < 300, status, json: async () => body };
    },
  };
  return deps;
}

const answersAcme = async (url: string) => {
  expect(url).toBe("https://markbase.acme.internal/api/v1/instance");
  return {
    status: 200,
    body: { supabase_url: acme.supabaseUrl, supabase_publishable_key: acme.supabaseKey },
  };
};

describe("connectToInstance", () => {
  it("saves, forgets the key, then relaunches", async () => {
    const deps = fake(answersAcme);
    const res = await connectToInstance("markbase.acme.internal", deps);
    expect(res).toEqual({ ok: true, appUrl: acme.appUrl, changed: true });
    expect(deps.saved).toEqual(acme);
    expect(deps.events).toEqual(["save", "forgetKey", "relaunch"]);
  });

  it("writes nothing when the URL is not an instance", async () => {
    const deps = fake(async () => ({ status: 404, body: {} }));
    const res = await connectToInstance("https://markbase.acme.internal", deps);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/does not answer \/api\/v1\/instance/);
    expect(deps.events).toEqual([]);
  });

  it("writes nothing when the instance cannot be reached", async () => {
    const deps = fake(async () => {
      throw new Error("ECONNREFUSED");
    });
    const res = await connectToInstance("http://localhost:3000", deps);
    expect(res).toEqual({
      ok: false,
      error: "Could not reach http://localhost:3000 (ECONNREFUSED).",
    });
    expect(deps.events).toEqual([]);
  });

  it("says what is wrong with a URL that is not one", async () => {
    const deps = fake(answersAcme);
    const res = await connectToInstance("not a url", deps);
    expect(res).toEqual({ ok: false, error: '"not a url" is not a URL.' });
    expect(deps.events).toEqual([]);
  });

  it("does not relaunch onto the instance it is already on", async () => {
    const deps = fake(async () => ({
      status: 200,
      body: { supabase_url: hosted.supabaseUrl, supabase_publishable_key: hosted.supabaseKey },
    }));
    const res = await connectToInstance("https://markbase.so/dashboard", deps);
    expect(res).toEqual({ ok: true, appUrl: hosted.appUrl, changed: false });
    expect(deps.events).toEqual([]);
  });

  it("does relaunch when the same URL now runs on another project", async () => {
    // The admin rebuilt the instance on a new Supabase project: the URL is the
    // same, the live document channel would not be.
    const deps = fake(async () => ({
      status: 200,
      body: { supabase_url: "https://new.supabase.co", supabase_publishable_key: "sb_publishable_new" },
    }));
    const res = await connectToInstance("https://markbase.so", deps);
    expect(res).toMatchObject({ ok: true, changed: true });
    expect(deps.events).toEqual(["save", "forgetKey", "relaunch"]);
  });

  it("keeps the key and the process when the save fails", async () => {
    const deps = fake(answersAcme);
    deps.save = async () => {
      throw new Error("EACCES");
    };
    const res = await connectToInstance(acme.appUrl, deps);
    expect(res).toEqual({ ok: false, error: "Could not save the instance (EACCES)." });
    expect(deps.events).toEqual([]);
  });
});

describe("instanceStatus", () => {
  it("knows the hosted app from a team's", () => {
    expect(instanceStatus("https://markbase.so", false)).toEqual({
      appUrl: "https://markbase.so",
      isDefault: true,
      fromEnv: false,
    });
    expect(instanceStatus("http://localhost:3000", true).isDefault).toBe(false);
  });
});
