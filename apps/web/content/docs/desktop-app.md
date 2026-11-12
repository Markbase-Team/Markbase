# Desktop app

The desktop app is the documents surface plus the sync that mirrors your
vaults to folders. It is for macOS on Apple silicon; download it from the
[releases page](/releases).

## Signing in

The app signs in through your instance's own sign-in page, inside its window.
Signed out, the switcher in the top-right corner of that page moves the app to
markbase.so or to another instance.

## Vaults

**New vault** creates a vault and its folder in one step, in
`~/Markbase/<name>` by default or in any folder you pick. A folder that
already belongs to a vault is refused before anything is created, and the
folder picker opens so you can choose another. Documents others share with
you sync into your Shared Vault, beside your own vaults under `~/Markbase`.

## Settings

**Settings** shows the account and which instance the app is on and, on a
team instance, the invite list and the join link.

Prefer the terminal, or working on a machine that is not a Mac? See the CLI
path in the [Quick start](/docs/quick-start#with-the-cli).
