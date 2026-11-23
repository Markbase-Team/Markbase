import { cookies } from "next/headers";
import { EMBED_MARKER_COOKIE } from "@markbase/shared/embed-cookies";

/**
 * Is this request from a card's frame that /embed signed in? The marker
 * cookie only exists there (partitioned under the site that framed it), so a
 * person's own tab never sees embed mode. The page also honours ?embed=1 on
 * the client (components/docs-surface), for the same frame before the marker
 * has been read.
 */
export async function inEmbedFrame(): Promise<boolean> {
  return (await cookies()).get(EMBED_MARKER_COOKIE) !== undefined;
}
