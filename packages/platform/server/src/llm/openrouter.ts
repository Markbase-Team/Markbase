// Tiny OpenRouter client (no SDK). OpenRouter is OpenAI-compatible, so this is
// a single chat-completions call.
// Server-only: reads OPENROUTER_API_KEY (and optional OPENROUTER_MODEL).
//
// This lived in @markbase/attention, which made attention a dependency of every
// feature that wanted a model: terms, reader, taskify and summary all imported
// it from there. That is how a feature package stops being a leaf — and a
// feature no one can remove is not a plugin. It is a shared capability, so it
// lives in a package of its own.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

// A message part: plain text, or an image (by URL) for vision-capable models.
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

// Content is either a plain string or an array of parts (text + images).
export type ChatMessage = {
  role: "system" | "user";
  content: string | ContentPart[];
};

type OpenRouterResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

// Parse JSON, tolerating a model that wraps it in ```json fences or prose.
function parseLoose<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    // fall through
  }
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(content.slice(start, end + 1)) as T;
    } catch {
      // fall through
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ask the model for JSON and parse it. Retries transient failures (network,
// 429, 5xx, or unparseable output) with a short backoff. Returns null only when
// the request genuinely fails or the output can't be parsed after retries —
// so callers can distinguish "model unavailable" from "model said no".
export async function chatJson<T>(messages: ChatMessage[]): Promise<T | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const ATTEMPTS = 3;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(300 * attempt);

    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      });
    } catch {
      continue; // network error — retry
    }

    if (res.status === 429 || res.status >= 500) continue; // transient — retry
    if (!res.ok) return null; // 4xx (bad request/auth) — won't improve on retry

    // `res.json()` is typed as unknown; name the shape we expect rather than
    // letting it spread. This was a latent error in the old home — attention has
    // no tsconfig, so nothing ever checked this file.
    const data = (await res.json()) as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) continue;

    const parsed = parseLoose<T>(content);
    if (parsed) return parsed;
    // unparseable — retry once more before giving up
  }
  return null;
}
