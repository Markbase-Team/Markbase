// Unsubscribe-target extraction. Pulls everything we need to unsubscribe from a
// message out of its headers and body, in priority order:
//   1. RFC 8058 one-click  — POST "List-Unsubscribe=One-Click" to the HTTPS URL
//      in the List-Unsubscribe header. No human / browser needed.
//   2. RFC 2369 List-Unsubscribe HTTPS URL — a page to open; the browser agent
//      drives it (find + click the confirm control).
//   3. A "unsubscribe"/"opt out" link scraped from the HTML body — same as (2),
//      for senders that don't set the header.
//   4. RFC 2369 mailto: target — send an email to unsubscribe (manual today).

export type UnsubscribeInfo = {
  // HTTPS endpoint from the List-Unsubscribe header (page to visit or POST to).
  httpUrl: string | null;
  // mailto: target from the List-Unsubscribe header.
  mailto: string | null;
  // True when List-Unsubscribe-Post advertises RFC 8058 one-click POST.
  oneClick: boolean;
  // Best unsubscribe link found in the body (fallback when no header is set).
  bodyUrl: string | null;
};

// Pull the `<...>` entries out of a List-Unsubscribe header value, e.g.
// `<https://x.com/u?id=1>, <mailto:unsub@x.com>` → both URLs.
function parseAngleList(value: string): string[] {
  const out: string[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const url = m[1].trim();
    if (url) out.push(url);
  }
  return out;
}

// First anchor in the HTML whose href or visible text reads like an unsubscribe
// link. Returns an absolute http(s) URL or null.
function findUnsubscribeLink(html: string): string | null {
  if (!html) return null;
  const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const keyword = /unsubscribe|opt[\s-]?out|manage (your )?(email )?preferences|email preferences/i;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(html)) !== null) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, " ");
    if (!/^https?:\/\//i.test(href)) continue;
    if (keyword.test(href) || keyword.test(text)) return href;
  }
  return null;
}

// Build the unsubscribe info from a header lookup + the message HTML. `getHeader`
// is case-insensitive and returns "" when a header is absent.
export function extractUnsubscribe(
  getHeader: (name: string) => string,
  html: string
): UnsubscribeInfo {
  const targets = parseAngleList(getHeader("List-Unsubscribe"));
  const httpUrl =
    targets.find((t) => /^https?:\/\//i.test(t))?.replace(/\s+/g, "") ?? null;
  const mailtoRaw = targets.find((t) => /^mailto:/i.test(t)) ?? null;
  const mailto = mailtoRaw ? mailtoRaw.replace(/^mailto:/i, "").trim() : null;
  const oneClick =
    !!httpUrl && /one-click/i.test(getHeader("List-Unsubscribe-Post"));

  return {
    httpUrl,
    mailto,
    oneClick,
    bodyUrl: httpUrl ? null : findUnsubscribeLink(html),
  };
}

// Is there anything we can act on? (UI hides the button when false.)
export function hasUnsubscribeTarget(info: UnsubscribeInfo): boolean {
  return !!(info.httpUrl || info.bodyUrl || info.mailto);
}
