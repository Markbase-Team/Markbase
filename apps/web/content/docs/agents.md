# Agents

Agents reach Markbase documents three ways. Pick by where the agent runs.

## On your machine: the files

An agent working in a mounted vault edits the markdown files directly, the way
it edits code. Nothing to install and no credential to hand out: the sync
daemon holds the only key, and the agent never sees it. This is the way we
recommend for Claude Code, Codex and Cursor working in a repository.

## In a chat app: MCP

```bash
npx @markbase/cli mcp install
```

adds the document tools to Claude Desktop, Claude Code, Codex and Cursor
(`--desktop`, `--claude-code`, `--codex` or `--cursor` to pick). The agent can
then list, read, create and edit documents, quote a passage to change it, and
comment.

## Anywhere: the HTTP API and the skill

Every action the browser takes is an HTTP endpoint at `/api/v1`, authorised
with an API key from the dashboard. The Markbase skill teaches an agent to use
it:

```bash
npx @markbase/cli skill install
```

installs it into `.claude/skills`. From the terminal, `markbase api <endpoint>`
calls any endpoint directly; `markbase api list` shows them all.

## Attribution

Every change is recorded in the document's history with who made it, person
or agent, so you can always see what an agent changed and undo it.
