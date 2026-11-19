# Agents

Agents reach Markbase documents three ways. Pick by where the agent runs.

## On your machine: the files

An agent working in a mounted vault edits the markdown files directly, the way
it edits code. Nothing to install and no credential to hand out: the sync
daemon holds the only key, and the agent never sees it. This is the way we
recommend for Claude Code, Codex and Cursor working in a repository.

## In a chat app: MCP

The Markbase MCP server gives Claude Desktop, Claude Code, Codex and Cursor
what you can do in the app as tools: find, read, create and edit documents,
comment, publish, share, and manage vaults.

Connect it from the desktop app, under **Settings › Agents › Connect agents**,
or from the terminal:

```
npx @markbase/cli mcp install
```

Either one adds a server called `markbase-docs` to every one of those agents
found on the machine (`--desktop`, `--claude-code`, `--codex` or `--cursor`
picks one from the terminal). Restart the agent afterwards so it loads the
tools.

The tools use the account this computer is signed in to, so signing in once
covers every agent. If nobody is signed in when an agent first uses a tool,
your browser opens to sign in, and the agent is told to try again once you
have approved. On a machine with no browser, set `MARKBASE_API_KEY` in the
agent's config for the server instead.

### An agent you install later, or another agent

An agent only sees the MCP servers listed in its own config. Installing
Markbase does not make a new agent find it, and neither does another agent
already being connected.

- **Claude Desktop, Claude Code, Codex or Cursor, installed after Markbase:**
  run `npx @markbase/cli mcp install` again, then restart the agent. It adds
  the new one and leaves the others as they are.
- **Any other agent that speaks MCP:** add a server to that agent's MCP
  settings yourself, with these values:

| Setting | Value |
| --- | --- |
| Name | `markbase-docs` |
| Command | `npx` |
| Arguments | `-y @markbase/cli mcp` |
| Environment | `MARKBASE_API_BASE` = `https://markbase.so/api/v1` (your own address if you self-host) |

You can also ask the agent to add it for you. Give it the command, so it does
not guess one: *"Add an MCP server named markbase-docs that runs
`npx -y @markbase/cli mcp`."*

No key is needed either way. The new agent uses the sign-in already saved on
the computer.

### At a URL, with nothing to install

The same tools are served at an address, for an agent that cannot run a
command on your machine or where you would rather not install Node:

```
https://markbase.so/mcp
```

On your own instance it is `/mcp` on your address. This is the only hosted
address; an agent that suggests another has guessed it.

Add the address to an agent that takes a remote MCP server and it asks you to
sign in: your browser opens on Markbase, you choose how much the agent may do
(view, comment, edit, or everything), and it is connected. Each agent
connected this way gets a key of its own, listed under **API keys** in the
dashboard, where you can change its access or revoke it without touching the
others.

<!-- connect-agents -->

The same thing by hand:

| Agent | How |
| --- | --- |
| Claude (desktop, web, mobile) | **Settings › Connectors › Add custom connector**, and paste the address |
| Claude Code | `claude mcp add --transport http markbase-docs https://markbase.so/mcp`, then `/mcp` to sign in |
| Codex | `codex mcp add markbase-docs --url https://markbase.so/mcp`, then `codex mcp login markbase-docs` |
| Cursor, VS Code | A server with `"url": "https://markbase.so/mcp"` in the MCP settings file |

An agent that cannot open a browser can send a key instead: make one under
**API keys** and send it as `Authorization: Bearer <key>`.

| Tool | What it does |
| --- | --- |
| `listDocs`, `searchDocs`, `readDoc` | Find documents, search their text, and read one as markdown |
| `createDoc`, `renameDoc`, `deleteDoc` | Create, rename and delete documents |
| `editDoc` | Replace a passage by quoting it, keeping the rest as written |
| `addComment`, `listComments`, `resolveComment` | Comment on a passage, read and resolve comments |
| `history`, `docAt`, `docDiff`, `restoreDoc` | Read past versions, compare them, restore one |
| `publishStatus`, `publish`, `unpublish` | Put a document on the web at a public URL, or take it down |
| `listLinks`, `createLink`, `deleteLink` | Share links: list, create and revoke |
| `listVaults`, `createVault`, `readVault`, `renameVault`, `deleteVault`, `convertFolderToVault` | Manage vaults |
| `listAssets` | The images and files in a vault, or the ones a document links to |
| `whoami`, `readProfile` | Whose key the agent is using |

The tools come from the server, not from the installed package: when Markbase
gains an action, the agent has the tool the next time it starts, with nothing
to update. Tools that delete are marked as destructive, so an agent's app can
ask before running them.

## Anywhere: the HTTP API and the skill

Every action the browser takes is an HTTP endpoint at `/api/v1`, authorised
with an API key from the dashboard. The Markbase skill teaches an agent to use
it.

Both are installed from the terminal; see
[Connect your agent](/docs/quick-start#3-connect-your-agent) in the Quick
start.

## Attribution

Every change is recorded in the document's history with who made it, person
or agent, so you can always see what an agent changed and undo it.

## Audit what agents read and write

An agent that edits a vault's files directly looks, to the sync, exactly like
you typing. To tell them apart, have the agent report itself: Claude Code,
Codex and Cursor can each run a command around their tool calls (a *hook*),
and the Markbase CLI has two commands made for it.

- `markbase read-audit` records each vault file an agent reads, and which
  agent read it.
- `markbase write-audit` records each vault file an agent writes: which agent,
  and exactly which characters it removed and inserted.

Both do nothing for a file outside a mounted vault, never block the agent, and
keep their record on your machine, under `~/.markbaseConfig/audit`.

The hooks come with Markbase. `npx @markbase/cli mcp install` adds them to
every agent it connects the document tools to, and the desktop app adds them
at launch for the agents it finds on the computer (Claude Code, Codex, Cursor),
once you are signed in. Running either again adds nothing twice, and a hooks
file that is read-only or not valid JSON is left as it is. To keep the app
from touching the agents' files, start it with `MARKBASE_AUDIT_HOOKS=off`.

To set the hooks up by hand, on a machine without the app, or for an agent
installed later:

```
markbase audit install
```

Once they are in place, a document's **History** says which agent wrote a
version: the version shows the agent's name where it would show yours, in the
desktop app and on the web. A version that holds both your edits and an
agent's names you both.

Every document also has an **Analytics** panel, beside Comments and History:

- **Read by agents**: how many times each agent read the document, and
  whose agent it was. A read counts whether the agent opened the file
  (through its hooks) or the document (through the MCP tools); reads by the
  same agent within a minute of each other count once.
- **Who wrote it**: how much of the document as it is now each person and
  each agent wrote.
- **Line by line**: which lines are whose.

See what was recorded:

```
markbase read-audit report                    # reads per file, by agent
markbase write-audit report                   # writes per file, by agent
markbase write-audit report --file notes/plan.md   # every change to one file
```

The sections below are what the installers write, for setting an agent up
yourself.

### Claude Code

In `~/.claude/settings.json` (or a project's `.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "markbase write-audit --agent claude" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Read",
        "hooks": [{ "type": "command", "command": "markbase read-audit --agent claude" }]
      },
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "markbase write-audit --agent claude" }]
      }
    ]
  }
}
```

### Codex

In `~/.codex/hooks.json`. Codex edits with `apply_patch` and reads files with
shell commands, so reads are found by looking for vault files in the command
and are marked as inferred.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "apply_patch",
        "hooks": [{ "type": "command", "command": "markbase write-audit --agent codex" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "markbase read-audit --agent codex" }]
      },
      {
        "matcher": "apply_patch",
        "hooks": [{ "type": "command", "command": "markbase write-audit --agent codex" }]
      }
    ]
  }
}
```

### Cursor

In `~/.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "beforeReadFile": [{ "command": "markbase read-audit --agent cursor" }],
    "afterFileEdit": [{ "command": "markbase write-audit --agent cursor" }]
  }
}
```

### What it can and cannot see

- The write hook runs twice on purpose: before the edit it keeps the file as
  it was, and after the edit it compares. With only the "after" hook, Claude
  Code and Cursor are still measured from what the tool reports; Codex is
  recorded as having written the file, without the characters.
- A file an agent changes through a shell command (`sed -i`, a script) is not
  an edit tool call, so no write is recorded for it.
- An agent with no hooks is not recorded at all. For one that can run a
  command some other way, call the commands yourself:
  `markbase read-audit --agent <name> --file <path>`, and
  `markbase write-audit --agent <name> --file <path> --before` then the same
  without `--before` once it has written.
