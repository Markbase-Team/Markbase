import { describe, it, expect } from "vitest";
import {
  fetchInstance,
  normalizeInstanceUrl,
  connectLink,
  joinLink,
  parseConnectLink,
} from "../src/instance";

// Joining an instance is one URL typed once — in the terminal or in the desktop
// app's field — and what is saved from it is what every later command and the
// desktop app connect to. The parsing and the check of the instance's answer are
// what decide whether a typo is caught there or shows up later as a daemon that
// cannot reach anything. The fetch is injected.

describe("normalizeInstanceUrl", () => {
  it("adds https and keeps only the origin", () => {
    expect(normalizeInstanceUrl("markbase.acme.internal")).toBe("https://markbase.acme.internal");
    expect(normalizeInstanceUrl("https://markbase.acme.internal/dashboard/docs")).toBe(
      "https://markbase.acme.internal"
    );
    expect(normalizeInstanceUrl("  https://markbase.acme.internal/  ")).toBe(
      "https://markbase.acme.internal"
    );
  });

  it("keeps an explicit http scheme and port (a dev server)", () => {
    expect(normalizeInstanceUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("gives a bare localhost http, since no dev server has a certificate", () => {
    expect(normalizeInstanceUrl("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeInstanceUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(normalizeInstanceUrl("localhost.example.com")).toBe("https://localhost.example.com");
  });

  it("refuses what is not an http(s) URL", () => {
    expect(() => normalizeInstanceUrl("")).toThrow(/No instance URL/);
    expect(() => normalizeInstanceUrl("ftp://x")).toThrow(/http\(s\)/);
    expect(() => normalizeInstanceUrl("not a url")).toThrow(/not a URL/);
  });
});

describe("fetchInstance", () => {
  const base = "https://markbase.acme.internal";
  const answer = (status: number, body: object) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it("returns the project the instance names", async () => {
    const info = await fetchInstance(
      base,
      answer(200, {
        app_url: base,
        supabase_url: "https://ref.supabase.co",
        supabase_publishable_key: "sb_publishable_x",
      })
    );
    expect(info).toEqual({
      app_url: base,
      supabase_url: "https://ref.supabase.co",
      supabase_publishable_key: "sb_publishable_x",
    });
  });

  it("falls back to the typed URL when the instance does not say its own", async () => {
    const info = await fetchInstance(
      base,
      answer(200, { supabase_url: "https://ref.supabase.co", supabase_publishable_key: "k" })
    );
    expect(info.app_url).toBe(base);
  });

  it("says when the URL is not a Markbase, or an old one", async () => {
    await expect(fetchInstance(base, answer(404, {}))).rejects.toThrow(/does not answer/);
  });

  it("says when the instance has no project configured", async () => {
    await expect(
      fetchInstance(base, answer(503, { error: "This instance has no Supabase project configured" }))
    ).rejects.toThrow(/HTTP 503.*no Supabase project configured/);
  });

  it("refuses an answer without a project", async () => {
    await expect(fetchInstance(base, answer(200, { supabase_url: "" }))).rejects.toThrow(
      /without a Supabase project/
    );
  });

  it("names the reason Node's fetch hides in `cause`", async () => {
    await expect(
      fetchInstance(base, async () => {
        throw new Error("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:3999") });
      })
    ).rejects.toThrow(/Could not reach .*ECONNREFUSED 127\.0\.0\.1:3999/);
  });

  it("names the address a refused port came back as", async () => {
    // localhost resolves to ::1 and 127.0.0.1; Node tries both and reports an
    // AggregateError whose own message is empty.
    const refused = new AggregateError(
      [new Error("connect ECONNREFUSED ::1:3999"), new Error("connect ECONNREFUSED 127.0.0.1:3999")],
      ""
    );
    await expect(
      fetchInstance(base, async () => {
        throw new Error("fetch failed", { cause: refused });
      })
    ).rejects.toThrow(/Could not reach .*connect ECONNREFUSED ::1:3999/);
  });

  it("says when the instance is unreachable", async () => {
    await expect(
      fetchInstance(base, async () => {
        throw new Error("ECONNREFUSED");
      })
    ).rejects.toThrow(/Could not reach .*ECONNREFUSED/);
  });
});

describe("connectLink / parseConnectLink", () => {
  // The link an instance's /join page offers, and what the app makes of it.
  it("round-trips an instance URL", () => {
    const link = connectLink("https://markbase.example.com/");
    expect(link).toBe("markbase://connect?instance=https%3A%2F%2Fmarkbase.example.com");
    expect(parseConnectLink(link)).toEqual({ appUrl: "https://markbase.example.com", inviteCode: null });
  });

  it("normalizes the instance the way the app saves it", () => {
    expect(parseConnectLink("markbase://connect?instance=localhost%3A3100")?.appUrl).toBe("http://localhost:3100");
    expect(parseConnectLink("markbase://connect?instance=markbase.example.com/dashboard")?.appUrl).toBe("https://markbase.example.com");
  });

  it("carries the invite code when the page has one", () => {
    const link = connectLink("https://markbase.example.com", "k3y_+/=");
    expect(link).toBe("markbase://connect?instance=https%3A%2F%2Fmarkbase.example.com&code=k3y_%2B%2F%3D");
    expect(parseConnectLink(link)).toEqual({ appUrl: "https://markbase.example.com", inviteCode: "k3y_+/=" });
    expect(parseConnectLink("markbase://connect?instance=localhost%3A3100&code=")?.inviteCode).toBeNull();
  });

  it("is null for anything that is not a connect link", () => {
    // The app's own pages live at markbase://app — never a request to switch.
    expect(parseConnectLink("markbase://app/index.html")).toBeNull();
    expect(parseConnectLink("https://markbase.example.com/join")).toBeNull();
    expect(parseConnectLink("markbase://connect")).toBeNull();
    expect(parseConnectLink("markbase://connect?instance=")).toBeNull();
    expect(parseConnectLink("markbase://connect?instance=ftp%3A%2F%2Fx")).toBeNull();
    expect(parseConnectLink("not a url")).toBeNull();
  });
});

describe("joinLink", () => {
  // What Settings shows an admin to copy: the instance's /join page.
  it("is the join page of the normalized instance", () => {
    expect(joinLink("https://markbase.example.com/")).toBe("https://markbase.example.com/join");
    expect(joinLink("localhost:3100")).toBe("http://localhost:3100/join");
    expect(joinLink("markbase.example.com/dashboard")).toBe("https://markbase.example.com/join");
  });

  it("carries the invite code the join page admits", () => {
    expect(joinLink("https://markbase.example.com", "k3y_+/=")).toBe(
      "https://markbase.example.com/join?code=k3y_%2B%2F%3D"
    );
  });
});
