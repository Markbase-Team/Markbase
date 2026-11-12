# Sharing

You share documents, not folders.

## The Shared Vault

A document someone shared with you does not land in one of your own vaults,
because its folder is the owner's. It lands in your **Shared Vault**, a folder
of your own, laid out by owner and title: `<owner>/<title>.md`. The same sync
keeps it in step, and you can rearrange your copy without moving the owner's
file.

```bash
npx @markbase/cli vault mount --shared ~/Markbase/shared
```

## What each role can do

- **Editor:** your edits merge into the document like anyone else's.
- **Viewer or commenter:** your file is written read-only. An editor that
  writes to it anyway keeps a private fork that never saves, and it becomes a
  normal edit if you are later made an editor.

Deleting the file leaves the share and touches nothing of the owner's. A new
file dropped into the Shared Vault is left alone: there is no owner to create
it for.

## Public links

A document can also be published as a public link, readable by anyone without
an account. See [Keep clients in the loop](/docs/keep-clients-in-the-loop).
