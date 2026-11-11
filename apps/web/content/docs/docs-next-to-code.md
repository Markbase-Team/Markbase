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
