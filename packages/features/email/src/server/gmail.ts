import { decryptToken } from "./crypto";
import type { EmailAccount } from "./accounts";
import { extractUnsubscribe, type UnsubscribeInfo } from "./unsubscribe";

// Thin Gmail REST client (no SDK). Reads only. We refresh a short-lived access
// token from the stored refresh token on each call; tokens stay server-side.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

async function getAccessToken(account: EmailAccount): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: decryptToken(account.refresh_token_enc),
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json: GoogleTokenResponse = await res.json();
  if (!res.ok || !json.access_token) {
    // Surface the exact Google reason so we can tell apart the failure modes:
    // invalid_grant (token revoked/expired/wrong account), invalid_client
    // (client id/secret mismatch), unauthorized_client (grant not allowed).
    console.error("[gmail] token refresh rejected", {
      email: account.email_address,
      status: res.status,
      error: json.error,
      error_description: json.error_description,
    });
    throw new Error(
      `Token refresh failed for ${account.email_address}: ${
        json.error ?? res.status
      }${json.error_description ? ` (${json.error_description})` : ""}`
    );
  }
  return json.access_token;
}

type GmailHeader = { name: string; value: string };
type GmailPayload = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
};
type GmailListResponse = {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
};

function header(payload: GmailPayload | undefined, name: string): string {
  const h = payload?.headers?.find(
    (x) => x.name.toLowerCase() === name.toLowerCase()
  );
  return h?.value ?? "";
}

function decodeB64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

// Strip tags + decode a handful of entities so HTML-only emails render as
// readable text (we never inject raw HTML into the page).
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Raw HTML body — preferred for display (rendered in a sandboxed iframe).
function extractHtml(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  const html = findPart(payload, "text/html");
  return html?.body?.data ? decodeB64Url(html.body.data) : "";
}

// Plain-text body — fallback when there's no HTML part.
function extractText(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeB64Url(plain.body.data);
  const html = findPart(payload, "text/html");
  if (html?.body?.data) return htmlToText(decodeB64Url(html.body.data));
  if (payload.body?.data) return decodeB64Url(payload.body.data);
  return "";
}

function findPart(
  payload: GmailPayload,
  mimeType: string
): GmailPayload | null {
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

export type InboxMessageSummary = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
};

export type InboxList = {
  messages: InboxMessageSummary[];
  nextPageToken: string | null;
};

export async function listInbox(
  account: EmailAccount,
  pageToken?: string,
  query: string = "in:inbox"
): Promise<InboxList> {
  const token = await getAccessToken(account);
  const auth = { Authorization: `Bearer ${token}` };

  const listUrl = new URL(`${GMAIL_BASE}/messages`);
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", "25");
  if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

  const listRes = await fetch(listUrl, { headers: auth });
  if (!listRes.ok) {
    throw new Error(`Gmail list failed: ${listRes.status}`);
  }
  const list: GmailListResponse = await listRes.json();
  const ids = list.messages ?? [];

  const messages = await Promise.all(
    ids.map(async ({ id }) => {
      const metaUrl = new URL(`${GMAIL_BASE}/messages/${id}`);
      metaUrl.searchParams.set("format", "metadata");
      for (const h of ["From", "Subject", "Date"]) {
        metaUrl.searchParams.append("metadataHeaders", h);
      }
      const metaRes = await fetch(metaUrl, { headers: auth });
      if (!metaRes.ok) return null;
      const msg: GmailMessage = await metaRes.json();
      const summary: InboxMessageSummary = {
        id: msg.id,
        threadId: msg.threadId,
        from: header(msg.payload, "From"),
        subject: header(msg.payload, "Subject"),
        date: header(msg.payload, "Date"),
        snippet: msg.snippet ?? "",
        unread: (msg.labelIds ?? []).includes("UNREAD"),
      };
      return summary;
    })
  );

  return {
    messages: messages.filter((m): m is InboxMessageSummary => m !== null),
    nextPageToken: list.nextPageToken ?? null,
  };
}

export type InboxMessageFull = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  html: string;
  body: string;
  unread: boolean;
  // Extracted unsubscribe targets (header + body), for the Unsubscribe button.
  unsubscribe: UnsubscribeInfo;
};

export async function getMessage(
  account: EmailAccount,
  id: string
): Promise<InboxMessageFull> {
  const token = await getAccessToken(account);
  const url = new URL(`${GMAIL_BASE}/messages/${id}`);
  url.searchParams.set("format", "full");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail get failed: ${res.status}`);
  const msg: GmailMessage = await res.json();
  const html = extractHtml(msg.payload);
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: header(msg.payload, "From"),
    to: header(msg.payload, "To"),
    subject: header(msg.payload, "Subject"),
    date: header(msg.payload, "Date"),
    html,
    body: extractText(msg.payload),
    unread: (msg.labelIds ?? []).includes("UNREAD"),
    unsubscribe: extractUnsubscribe((name) => header(msg.payload, name), html),
  };
}

// Mark a message read by removing the UNREAD label. Requires the gmail.modify
// scope (accounts connected with read-only will get a 403 until reconnected).
export async function markMessageRead(
  account: EmailAccount,
  id: string
): Promise<void> {
  const token = await getAccessToken(account);
  const res = await fetch(`${GMAIL_BASE}/messages/${id}/modify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
  if (!res.ok) throw new Error(`Gmail modify failed: ${res.status}`);
}
