Markbase now has an MCP server at an address: `https://markbase.so/mcp`. Add it to your agent, sign in once in the browser, and the agent can find, read, edit and comment on your documents. There is nothing to install, no Node, and no key to paste.

## What the agent can do

- **Read and search.** Find a document, search across a vault, and read any document as markdown.
- **Edit a passage, not the whole file.** The agent quotes the text it wants to change and replaces only that, so the rest stays as you wrote it.
- **Comment and resolve.** It can leave a comment on a line, read the thread, and resolve it.
- **Go back in time.** Read an earlier version, compare two, and restore one.
- **Publish and share.** Put a document on the web, take it down, and manage share links.

Every change the agent makes goes into the document's history under its own name, so you can see what it changed and undo it.

## You decide what it may do

When you sign in, Markbase asks how much the agent may do: view, comment, edit, or everything. The agent gets a key of its own, listed under **API keys** in the dashboard. You can change its access or revoke it there without touching your other agents. Tools that change or remove something are marked as such, so your agent's app can ask you before running them.

## Claude

Claude on the web, on the desktop and on your phone share one list of connectors. Open **Settings › Connectors**, choose **Add custom connector**, paste `https://markbase.so/mcp`, and sign in when Claude asks.

## Claude Code

```
claude mcp add --transport http markbase-docs https://markbase.so/mcp
```

Then run `/mcp` in Claude Code and choose **markbase-docs** to sign in.

## Codex

```
codex mcp add markbase-docs --url https://markbase.so/mcp
codex mcp login markbase-docs
```

The second command opens the browser to sign in.

## Cursor

The **Cursor** button in the dashboard, under **API keys › Connect an agent**, opens Cursor and asks you to install Markbase. To do it by hand, add this to `~/.cursor/mcp.json`:

```
{
  "mcpServers": {
    "markbase-docs": { "url": "https://markbase.so/mcp" }
  }
}
```

Cursor asks you to sign in the first time it uses the server.

## VS Code

VS Code adds a server without starting it, so there is one more step than elsewhere. The command that adds it:

```
code --add-mcp '{"name":"markbase-docs","type":"http","url":"https://markbase.so/mcp"}'
```

1. Run the command above, or press the **VS Code** button in the dashboard.
2. Open the Command Palette (⌘⇧P), run **MCP: List Servers**, pick **markbase-docs**, and choose **Start Server**.
3. When VS Code asks to let it sign in to markbase.so, click **Allow**, then approve in the browser.
4. In Copilot Chat, switch to **Agent** mode and ask "List my Markbase vaults".

## opencode

```
opencode mcp add markbase-docs --url https://markbase.so/mcp
opencode mcp auth markbase-docs
```

You can also run `/mcps` inside opencode, pick the server and sign in from there.

## Pi

Pi has MCP built in from 1.0. Add the server to `~/.pi/agent/mcp.json`:

```
{
  "mcpServers": {
    "markbase-docs": { "url": "https://markbase.so/mcp" }
  }
}
```

Then run `/mcp login markbase-docs` in a session, or `pi mcp login markbase-docs` in the terminal.

## OpenClaw

```
openclaw mcp add markbase-docs --url https://markbase.so/mcp --transport streamable-http
openclaw mcp login markbase-docs
```

Set the transport: without it OpenClaw assumes the older SSE transport, which Markbase does not serve. You can also sign in from **Settings › MCP**.

## Any other agent

If an agent takes a remote MCP server, it works with Markbase: give it `https://markbase.so/mcp` and sign in when it asks. An agent that cannot open a browser can send a key instead. Make one under **API keys** and send it as `Authorization: Bearer <key>`.

If you run your own Markbase, the address is `/mcp` on your own domain. The full list of tools, and the other ways agents reach Markbase, are in the [agents docs](/docs/agents).
