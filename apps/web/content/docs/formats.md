# Formats

## Markdown

A vault syncs the `.md` files in its folder, one file per document:
headings, lists, task lists, tables, code blocks, links and images, in
GitHub-flavoured markdown.

Front matter you wrote stays as you wrote it. Two keys are added to each
synced file's front matter, `markbase_id` and `markbase_version`. They are how
a document survives a rename or a move: file it wherever you like, it is still
the same document.

## Images

An image a document references, `![diagram](assets/diagram.png)`, is uploaded
with it and downloaded wherever the vault is mounted, so the folder renders
offline in any editor. Images are compared by content, never by name.

## What is left alone

PDFs, an Obsidian workspace, `.DS_Store`: a vault sits next to other files and
never touches them. Dotfiles and dot-folders are never synced.

## .markbaseignore

A `.markbaseignore` file at the vault root lists what else to skip, one
pattern per line. It is created with the usual build folders (`node_modules`,
`dist`, `build`) the first time a vault is mounted, and it travels with the
folder, so every machine skips the same things.
