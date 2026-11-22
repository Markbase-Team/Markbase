import { describe, it, expect } from "vitest";
import {
  AUTHORIZE_PATH,
  authorizeFraming,
  authorizeUrl,
  signedOutRedirect,
  type AuthorizeQuery,
} from "../src/device-auth-contract";

// The device builds a URL; the page reads it. These test the two together,
// because each side being right about its own half is how this broke before:
// the desktop stopped sending the flag the page needed, and a person who had
// just signed in was left looking at the CLI's Authorize button.

/** What the page would receive for the URL a device opened. */
function received(url: string): AuthorizeQuery {
  const u = new URL(url);
  expect(u.pathname).toBe(AUTHORIZE_PATH);
  return Object.fromEntries(u.searchParams) as AuthorizeQuery;
}

const device = { callback: "http://127.0.0.1:50123", state: "nonce-1" };

/** What the page receives after a signed-out visitor logs in and comes back. */
function afterLogin(query: AuthorizeQuery): AuthorizeQuery {
  const bounce = new URL(signedOutRedirect(query), "https://markbase.so");
  expect(bounce.pathname).toBe("/login");
  const next = bounce.searchParams.get("next") as string;
  expect(next.startsWith(`${AUTHORIZE_PATH}?`)).toBe(true);
  return received(`https://markbase.so${next}`);
}

describe("a visitor who has to log in first", () => {
  it("comes back to the same request, inert key and desktop framing included", () => {
    const sent = received(
      authorizeUrl("https://markbase.so", { ...device, desktop: true, confirm: true, claudeVersion: "2.1.0" })
    );
    const back = afterLogin(sent);
    expect(back).toEqual(sent);
    expect(authorizeFraming(back)).toEqual(authorizeFraming(sent));
  });

  it("keeps the CLI's pre-selected capability", () => {
    const sent = { ...received(authorizeUrl("https://markbase.so", device)), capability: "viewer" };
    expect(afterLogin(sent)).toEqual(sent);
  });

  it("does not invent parameters the request did not carry", () => {
    const sent = received(authorizeUrl("https://markbase.so", device));
    const back = afterLogin(sent);
    expect(Object.keys(back).sort()).toEqual(["callback", "state"]);
  });
});

describe("a desktop sign-in", () => {
  it("gets a page that finishes by itself and says Sign in", () => {
    const framing = authorizeFraming(received(authorizeUrl("https://markbase.so", { ...device, desktop: true })));
    expect(framing.desktop).toBe(true);
    expect(framing.autoFinish).toBe(true);
    expect(framing.title).toBe("Sign in to Markbase");
  });
});

describe("a CLI sign-in", () => {
  it("gets the page with the capability picker and the Authorize button", () => {
    const framing = authorizeFraming(received(authorizeUrl("https://markbase.so", device)));
    expect(framing.desktop).toBe(false);
    expect(framing.autoFinish).toBe(false);
    expect(framing.title).toBe("Connect the markbase CLI");
  });
});

describe("the rest of the request", () => {
  it("carries the callback and the state through unchanged", () => {
    const q = received(authorizeUrl("https://markbase.so/", device));
    expect(q.callback).toBe(device.callback);
    expect(q.state).toBe(device.state);
  });

  it("asks for an inert key only when told to", () => {
    expect(authorizeFraming(received(authorizeUrl("https://markbase.so", { ...device, confirm: true }))).confirm).toBe(true);
    expect(authorizeFraming(received(authorizeUrl("https://markbase.so", device))).confirm).toBe(false);
  });

  it("passes the Claude version along, bounded, and reads none as empty", () => {
    expect(authorizeFraming(received(authorizeUrl("https://markbase.so", { ...device, claudeVersion: " 2.0.1 " }))).claudeVersion).toBe("2.0.1");
    expect(authorizeFraming(received(authorizeUrl("https://markbase.so", device))).claudeVersion).toBe("");
    expect(authorizeFraming({ claude: "x".repeat(300) }).claudeVersion).toHaveLength(100);
  });

  it("does not double the slash for an app URL that ends in one", () => {
    expect(authorizeUrl("https://markbase.so/", device)).toMatch(/^https:\/\/markbase\.so\/cli-auth\?/);
  });
});
