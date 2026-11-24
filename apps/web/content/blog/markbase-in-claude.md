When Claude reads or writes one of your Markbase documents, you now see the document itself in the conversation: the title, the headings, the lists and tables, laid out as they read in Markbase. Before, you got whatever Claude chose to quote. Press **Open full page** and the whole document opens beside the chat, so you can read it while you keep talking to Claude about it.

## What you see in the chat

- **The document, as it reads.** The card shows the title, who you are on the document (owner, editor, commenter or viewer), its version and when it last changed, then the text, rendered. A long document is cut short with a **Show more** button, so the chat stays readable.
- **Open full page.** The whole document opens in the panel beside the conversation. Claude's reply stays on the left; the document stays on the right while you ask about it, scroll it and quote it back.
- **Open in Markbase.** Opens the document in Markbase, where you can edit it, comment, see its history and share it.
- **The same for new documents.** When you ask Claude to write something into Markbase, the card shows what it wrote, so you can check it without leaving the chat.

## Try it

If you connected Markbase to Claude before today, disconnect it and connect it again, so Claude picks up the cards.

1. In Claude, connect **Markbase** from the connectors directory.
2. Ask Claude for a document, for example: `Show me my Markbase doc "Q4 plan"`.
3. Press **Open full page** on the card to read it beside the chat.

## How it works

The cards use MCP Apps, the open extension for interactive connectors. The card draws the document from the answer Markbase already gave Claude, so it shows up at once. Agents and apps that don't show cards get the same text as before, so nothing changes for Claude Code, Codex, Cursor or the other agents you use with Markbase.

Markbase is in [Claude's connectors directory](https://claude.ai/directory/markbase). To connect another agent, see [Connect any agent to Markbase with one address](/blog/hosted-mcp-server).
