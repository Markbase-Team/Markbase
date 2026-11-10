// Server-only entrypoint: Attention board/item storage + the email classifier.
// Holds the service-role key and the OpenRouter key, so it must never be
// imported from a Client Component.
export * from "./attention";
// chatJson and ContentPart moved to @markbase/llm. They were never attention's
// to own: terms, reader, taskify and summary all imported them from here, which
// made attention impossible to leave out of a build.
// The unread sweep composes email's inbox with the classifier; the manifest
// declares `requires: ["email"]` for exactly this import.
export { classifyUnreadEmails } from "./classify-unread";
