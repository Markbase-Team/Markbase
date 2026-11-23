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

/**
 * The things to try, for an account whose newest document is `newestTitle`
 * (null when it has none). The first works on a blank account; the second
 * uses whatever the person was already doing with their agent; the third
 * shows comments, on a document they already have.
 */
export function startSuggestions(newestTitle: string | null): StartSuggestion[] {
  const suggestions: StartSuggestion[] = [
    {
      title: "Draft a new document",
      description: "Meeting notes, a spec, a blog post. Say what it is about and it is written into your vault.",
      prompt: "Help me draft a new document in Markbase. Ask me what it should be about, then write it into my vault and show it to me.",
    },
    {
      title: "Save this conversation as a document",
      description: "Keep what you have worked out here as a document you can edit and share.",
      prompt: "Save the useful parts of this conversation as a new Markbase document in my vault, with a clear title, then show it to me.",
    },
  ];
  if (newestTitle) {
    suggestions.push({
      title: "Review a document and comment on it",
      description: `Get a comment on "${newestTitle}" without its text being changed.`,
      prompt: `Read my Markbase document "${newestTitle}" and leave one comment on it with a concrete suggestion. Do not edit the text.`,
    });
  }
  return suggestions;
}

/** The starters a person can pick in their agent's app. */
export const MCP_PROMPTS: readonly McpPrompt[] = [
  {
    name: "get_started",
    title: "Get started with Markbase",
    description: "See your vault and a few things to try.",
    text: "I just connected Markbase. Show me what I have there and what I can do with it.",
  },
  {
    name: "draft_document",
    title: "Draft a document in Markbase",
    description: "Write something new into your vault.",
    text: startSuggestions(null)[0].prompt,
  },
  {
    name: "save_conversation",
    title: "Save this conversation to Markbase",
    description: "Keep this conversation as a document.",
    text: startSuggestions(null)[1].prompt,
  },
];
