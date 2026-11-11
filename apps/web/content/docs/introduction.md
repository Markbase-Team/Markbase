# Introduction

Markbase is one markdown folder for your team and its agents. Your documents
are plain `.md` files in a folder you own, and that folder stays in sync with
everyone who works on them: teammates in the browser or the desktop app, and
the AI agents you already run, editing the same files on disk.

## Why a folder

Most tools keep your writing in their database and give agents a copy to read.
Markbase keeps it as files. That has three consequences:

- **Agents need no integration.** Claude Code, Codex, Cursor, anything that
  edits files, works on the markdown directly. The sync takes care of the rest.
- **Nothing is locked in.** The folder is yours. Open it in any editor, commit
  it to git, or stop using Markbase; the files are still there.
- **One version.** Edits from the browser, the app and every agent merge into
  the same document, so nobody works from a stale copy.

## How it fits together

- A **vault** is a set of documents in the cloud and, on each machine that
  mounts it, one folder that mirrors them. See [Vaults](/docs/vaults).
- **People** read and write in the browser or the desktop app, with comments
  anchored to the text, version history and sharing.
- **Agents** edit the files in the folder, or reach documents through the HTTP
  API and the Markbase skill. See [Agents](/docs/agents).

## Where to go next

- [Quick start](/docs/quick-start): from an account to an agent editing a
  synced document, in a few minutes.
- [Docs next to your code](/docs/docs-next-to-code): the way we expect teams
  to work.
- [Self-hosting](/docs/self-hosting): run your own instance for a team.
