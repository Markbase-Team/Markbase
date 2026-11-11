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

## Rules a folder follows

- A folder belongs to exactly one vault, and a vault to one account. A folder
  that already is a vault, sits inside one, or contains one is refused for
  another, at the moment you pick it.
- Deleted documents move to a `.trash` folder inside the vault.
- The vault's own state lives in a hidden `.markbase` folder. Leave it alone.
