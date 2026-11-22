import type { StreamChunk } from "./types/chat";

/**
 * Wording the CLI uses when a run failed but reported it as ordinary prose.
 *
 * Kept narrow on purpose. These are the CLI's own failure sentences, and the
 * point is to notice them — not to reinterpret the agent's replies. A document
 * that happens to discuss an API error produces a text chunk too, so a loose
 * rule here would fill the log with false alarms and teach everyone to ignore it.
 */
const FAILURE_PHRASES = [
  "Failed to authenticate.",
  "API Error: 4",
  "API Error: 5",
  "Credit balance is too low",
];

/**
 * The failure this chunk reports, or null if it is not reporting one.
 *
 * A run can fail without throwing, and — worse — without being an error. Most
 * failures arrive as a result message that becomes an `error` chunk. But "Failed
 * to authenticate. API Error: 403 Request not allowed" is not even that: the CLI
 * emits it as an ORDINARY assistant message (`model: "<synthetic>"`),
 * indistinguishable in shape from the agent replying to you. It happened 13 times
 * across six folders in under a month with no trace anywhere but the SDK's own
 * transcript.
 *
 * Matching on wording is not a thing to be proud of; there is no structured
 * signal to key on. It is confined here, and callers log the message verbatim, so
 * a future variant stays legible even if this stops recognising it.
 *
 * Returns the message rather than a boolean so the narrowing happens once, here,
 * where the chunk's shape is actually examined.
 */
export function failureIn(chunk: StreamChunk): string | null {
  if (chunk.type === "error") return chunk.content;
  if (chunk.type !== "text") return null;
  // Leading text only: the CLI puts these sentences at the start of a synthetic
  // message, whereas an agent quoting an error mid-explanation is discussing
  // one, not suffering it.
  const opening = chunk.content.trimStart().slice(0, 120);
  return FAILURE_PHRASES.some((phrase) => opening.startsWith(phrase)) ? chunk.content : null;
}
