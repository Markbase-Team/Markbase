# Vaults

A vault is a set of documents in the cloud and, on each machine that mounts
it, one folder that mirrors them.

## Mounting

Mount a vault from the desktop app (**New vault**, or the Vaults menu) or from
the terminal:

```bash
npx @markbase/cli vault mount "Team notes" ~/Code/my-app/docs
npx @markbase/cli vault list
```

The first vault defaults to `~/Markbase/<name>`. Unmounting stops syncing on
that machine and leaves the files where they are:

```bash
npx @markbase/cli vault unmount "Team notes"
```

## How sync works

A background sync keeps the folder and the cloud in step, both ways. Save a
file and it is in the browser; edit in the browser and the file changes.
Edits made at the same time, by two people or by a person and an agent, are
merged rather than overwritten. Think of it as git without push and pull.

When the same lines were changed in two places and cannot be merged, the
document keeps the cloud's text and your version is saved in a `.conflicts`
folder inside the vault, so nothing is lost.

## Formats

What a vault syncs, and what it leaves alone.

### Markdown

A vault syncs the `.md` files in its folder, one file per document:
headings, lists, task lists, tables, code blocks, links and images, in
GitHub-flavoured markdown.

Front matter you wrote stays as you wrote it. Two keys are added to each
synced file's front matter, `markbase_id` and `markbase_version`. They are how
a document survives a rename or a move: file it wherever you like, it is still
the same document.

### Images

An image a document references, `![diagram](assets/diagram.png)`, is uploaded
with it and downloaded wherever the vault is mounted, so the folder renders
offline in any editor. Images are compared by content, never by name.

### What is left alone

PDFs, an Obsidian workspace, `.DS_Store`: a vault sits next to other files and
never touches them. Dotfiles and dot-folders are never synced.

### .markbaseignore

A `.markbaseignore` file at the vault root lists what else to skip, one
pattern per line. It is created with the usual build folders (`node_modules`,
`dist`, `build`) the first time a vault is mounted, and it travels with the
folder, so every machine skips the same things.

## Rules a folder follows

- A folder belongs to exactly one vault, and a vault to one account. A folder
  that already is a vault, sits inside one, or contains one is refused for
  another, at the moment you pick it.
- Deleted documents move to a `.trash` folder inside the vault.
- The vault's own state lives in a hidden `.markbase` folder. Leave it alone.
