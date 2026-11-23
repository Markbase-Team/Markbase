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
