# Agents

Agents reach Markbase documents three ways. Pick by where the agent runs.

## On your machine: the files

An agent working in a mounted vault edits the markdown files directly, the way
it edits code. Nothing to install and no credential to hand out: the sync
daemon holds the only key, and the agent never sees it. This is the way we
recommend for Claude Code, Codex and Cursor working in a repository.

## In a chat app: MCP

The Markbase MCP server gives Claude Desktop, Claude Code, Codex and Cursor the
document tools: list, read, create and edit documents, quote a passage to
change it, and comment.

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

Set the hooks up for every agent on the machine with one command:

```
markbase audit install
```

Once they are in place, a document's **History** says which agent wrote a
version: the version shows the agent's name where it would show yours, in the
desktop app and on the web. A version that holds both your edits and an
agent's names you both.

See what was recorded:

```
markbase read-audit report                    # reads per file, by agent
markbase write-audit report                   # writes per file, by agent
markbase write-audit report --file notes/plan.md   # every change to one file
```

The sections below are what `markbase audit install` writes, for setting an
agent up by hand.

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
