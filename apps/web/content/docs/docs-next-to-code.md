# Docs next to your code

The way we expect a team to work: keep the vault in the repository, beside the
code it describes, so designers, engineers, product managers and agents all
work from the same knowledge.

## Put the vault in the repository

Mount a vault on the repository's `docs/` folder, or on the repository root:

```bash
npx @markbase/cli vault mount "my-app" ~/Code/my-app/docs
```

The markdown is committed like any other file. The vault adds live sync,
comments and sharing on top, and takes nothing away: the repository still
works without it.

If you mount the repository root, list what is not documentation in
`.markbaseignore` at the vault root. It starts with the usual build folders
(`node_modules`, `dist`, `build`), so a vault inside a code repository holds
your notes, not every README under `node_modules`.

## Who does what

- **Engineers and agents** work in the working tree. `CLAUDE.md`, `AGENTS.md`,
  the spec, the decision records and the runbooks are plain files that Claude
  Code, Codex or any editor read and write in place.
- **Product managers and designers** open the same documents in the browser or
  the desktop app, write the requirements and the handoff notes there, and
  leave comments on the exact line.
- **Everyone, and every agent, reads one version.** The spec an agent builds
  from this afternoon is the one the PM edited this morning, with the
  designer's notes in it and the open questions resolved in the margin.

## Teammates who do not clone the repository

Share the documents they need. Each lands in that person's
[Shared Vault](/docs/sharing), a folder of their own, next to their other
notes, and stays in sync with yours.

## Specs and handoffs

A spec is only useful if the person building from it, or the agent, is reading
the version that was agreed. Markbase keeps that version in one place.

### Write once, build from it

- The product manager writes the requirement as a document, in the browser or
  the app.
- The designer adds states, rationale and edge cases to the same document,
  next to the requirement they belong to.
- The engineer's agent reads that document from the vault folder when it
  implements, so it builds from the current text, not a pasted copy.

### Settle questions on the line

Comments are anchored to the text they are about. An agent with the Markbase
skill can raise a question as a comment on the exact line; a person answers
it there and resolves it when it is settled. The discussion stays attached to
the spec instead of a chat thread.

### See what changed

Every document keeps its version history, with each change attributed to the
person or agent who made it. Open the history to see what the spec said when
work started, or to restore an earlier version.
