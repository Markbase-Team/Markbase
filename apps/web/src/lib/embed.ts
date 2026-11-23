import { createHash } from "node:crypto";

// The embed experiment's switch (docs/embed-proof.md): the real app framed
// full page inside an AI app's card. On only where MARKBASE_EMBED_FRAME_ANCESTORS
// names the sites allowed to frame it (next.config.ts). Off, the hand-off
// routes answer 404 and the MCP server offers neither the tools nor the card.

export function embedEnabled(): boolean {
  return Boolean(process.env.MARKBASE_EMBED_FRAME_ANCESTORS?.trim());
}

/** A document id as it may sit in an address. */
export const EMBED_DOC_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Where in the app a hand-off lands: a document (or the documents list), in embed mode. */
export function embedTarget(docId: string | null | undefined): string {
  const path = docId && EMBED_DOC_ID.test(docId) ? `/dashboard/documents/${docId}` : "/dashboard/documents";
  return `${path}?embed=1`;
}

/**
 * The sandbox host Claude gives this server's cards when they set it as
 * `_meta.ui.domain`: the first 32 hex characters of the SHA-256 of the
 * server's URL, under claudemcpcontent.com (Claude's MCP Apps docs). Fixed,
 * so the app can allow exactly this host to frame it — the wildcard would let
 * every connector's cards frame markbase.so.
 */
export function claudeCardHost(serverUrl: string): string {
  return `${createHash("sha256").update(serverUrl).digest("hex").slice(0, 32)}.claudemcpcontent.com`;
}
