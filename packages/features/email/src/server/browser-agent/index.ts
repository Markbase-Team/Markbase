// Unsubscribe agent — turns a set of unsubscribe targets into an action.
//
// Tries, in order:
//   1. RFC 8058 one-click — POST "List-Unsubscribe=One-Click" to the header URL.
//      No browser needed; this covers most modern bulk senders.
//   2. Browser agent — open the unsubscribe page and click through the
//      confirmation (header URL first, then a link scraped from the body).
//   3. mailto — report that the only option is to email; we don't auto-send.

import { driveUnsubscribe } from "./browser";
import type { UnsubscribeResult, UnsubscribeTarget } from "./types";

export type { UnsubscribeResult, UnsubscribeTarget } from "./types";
export type { UnsubscribeMethod } from "./types";

// RFC 8058: a single POST with this body unsubscribes, no page interaction.
async function oneClickPost(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
      redirect: "follow",
    });
    return res.status < 400;
  } catch {
    return false;
  }
}

export async function runUnsubscribe(
  target: UnsubscribeTarget
): Promise<UnsubscribeResult> {
  // 1. One-click — fastest and most reliable when offered.
  if (target.oneClick && target.httpUrl) {
    if (await oneClickPost(target.httpUrl)) {
      return {
        ok: true,
        method: "one-click",
        message: "Unsubscribed — the sender accepted a one-click request.",
        finalUrl: target.httpUrl,
      };
    }
    // One-click failed; fall through to the browser agent on the same URL.
  }

  // 2. Browser agent on the header URL, falling back to a body link.
  const pageUrl = target.httpUrl ?? target.bodyUrl;
  if (pageUrl) {
    const drive = await driveUnsubscribe(pageUrl);
    if (!drive.available) {
      return {
        ok: false,
        method: "browser",
        message:
          "The browser agent isn't available in this environment. Open the unsubscribe page to finish.",
        manualUrl: pageUrl,
      };
    }
    return {
      ok: drive.ok,
      method: "browser",
      message: drive.ok
        ? "The browser agent opened the page and confirmed the unsubscribe."
        : "The browser agent ran but couldn't confirm it — you may need to finish on the page.",
      finalUrl: drive.finalUrl,
      steps: drive.steps,
      manualUrl: drive.ok ? undefined : pageUrl,
    };
  }

  // 3. mailto only.
  if (target.mailto) {
    return {
      ok: false,
      method: "mailto",
      message: "This sender only supports unsubscribing by email.",
      mailto: target.mailto,
    };
  }

  return {
    ok: false,
    method: "none",
    message: "No unsubscribe option was found in this email.",
  };
}
