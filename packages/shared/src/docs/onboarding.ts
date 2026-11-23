import type { McpPrompt } from "../mcp-http";

// What a person who has just connected an agent is shown, as text.
//
// A connector cannot speak first: nothing appears in the conversation until
// the person sends a message. So the agent is told, when it connects, what
// Markbase is for and what to offer (`MCP_INSTRUCTIONS`); the person is given
// starters to pick in their agent's app (`MCP_PROMPTS`); and `docs_getStarted`
// answers with things to try (`startSuggestions`), which the Get started card
// (./apps/start-app) turns into buttons.
//
// All of it is here, in one file, because it is the part most likely to be
// rewritten once the record shows which of these people actually press.

/** The tool that answers with the account's vaults, newest documents and things to try. */
export const GET_STARTED_TOOL = "docs_getStarted";

/** Told to the agent in `initialize`. Short: it is read on every connection. */
export const MCP_INSTRUCTIONS = [
  "Markbase is the person's collaborative markdown workspace: documents live in vaults, and people and their agents edit the same documents.",
  `When the person has just connected Markbase, asks what it is or what they can do with it, or seems unsure where to begin, call ${GET_STARTED_TOOL} first and offer what it suggests.`,
  "To write something for them, create a document with docs_createDoc (it goes to their default vault unless they name one). To change one, read it with docs_readDoc, then use docs_editDoc on the exact passage. Leave a comment with docs_addComment instead of editing when you are suggesting rather than changing.",
  "To share a document, create a share link with docs_createLink (`member` for a signed-in person and their agent, `guest` for anyone with the link) and give the person the link. Sharing needs Owner access on this connection; if it is refused, say they can share from Markbase with the Share button or allow it under API keys.",
  "After creating or changing a document, tell the person its title and that they can open it in Markbase.",
].join(" ");

/** One thing to try: a button on the Get started card, and what pressing it sends. */
export interface StartSuggestion {
  /** The button. */
  title: string;
  /** One line under it. */
  description: string;
  /** Sent into the conversation as the person's own message. */
  prompt: string;
}

/** How a suggestion names the document it is about: by title, or by asking. */
function which(title: string | null): { name: string; ask: string } {
  return title
    ? { name: `"${title}"`, ask: `my Markbase document "${title}"` }
    : { name: "one of your documents", ask: "one of my Markbase documents (ask me which)" };
}

/**
 * The things to try, for an account whose newest document is `newestTitle`
 * (null when it has none, and the person is asked which). Three, each showing
 * one thing Markbase does that a chat on its own does not: keep what was
 * worked out, get feedback without losing your text, and hand it to someone.
 */
export function startSuggestions(newestTitle: string | null): StartSuggestion[] {
  const doc = which(newestTitle);
  return [
    {
      title: "Summarize this conversation as a document",
      description: "Keep what you have worked out here as a document you can edit and share.",
      prompt:
        "Summarize this conversation as a new Markbase document in my vault: a clear title, the decisions and the open questions. Then show it to me.",
    },
    {
      title: "Review a document and comment on it",
      description: `Get comments on ${doc.name} without its text being changed.`,
      prompt: `Read ${doc.ask} and leave a few comments on it with concrete suggestions. Do not edit the text.`,
    },
    {
      title: "Share a document with someone",
      description: `Hand ${doc.name} to another person, or their agent, to read, comment on or edit.`,
      prompt:
        `Share ${doc.ask} with someone. Ask me whether they should be able to view, comment or edit, then create a share link and give it to me. ` +
        "If Markbase refuses because this connection cannot share, tell me I can share it from Markbase with the Share button, or allow sharing for this connection under API keys.",
    },
  ];
}

/** The starters a person can pick in their agent's app. They name no document: the agent asks. */
export const MCP_PROMPTS: readonly McpPrompt[] = [
  {
    name: "get_started",
    title: "Get started with Markbase",
    description: "See your vault and a few things to try.",
    text: "I just connected Markbase. Show me what I have there and what I can do with it.",
  },
  {
    name: "summarize_conversation",
    title: "Summarize this conversation as a document",
    description: "Keep this conversation as a Markbase document.",
    text: startSuggestions(null)[0].prompt,
  },
  {
    name: "review_document",
    title: "Review a document and comment on it",
    description: "Get comments on a document without its text being changed.",
    text: startSuggestions(null)[1].prompt,
  },
  {
    name: "share_document",
    title: "Share a document with someone",
    description: "Hand a document to another person or their agent.",
    text: startSuggestions(null)[2].prompt,
  },
];
