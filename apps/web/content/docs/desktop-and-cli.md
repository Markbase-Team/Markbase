# Desktop app and CLI

## The desktop app

The desktop app is the documents surface plus the sync that mirrors your
vaults to folders. It is for macOS on Apple silicon; download it from the
[releases page](/releases). The build is not notarised yet: the first time,
right-click the app and choose **Open**.

- It signs in through your instance's own sign-in page, inside its window.
- **New vault** creates a vault and its folder in one step.
- **Settings** shows the account, which instance the app is on and, on a team
  instance, the invite list and link.
- Signed out, an instance switcher in the corner of the sign-in page moves the
  app to markbase.so or to another instance.

## The CLI

`@markbase/cli` runs the same sync without a window, on any machine with
Node.js.

```bash
npx @markbase/cli login                       # sign in, install the sync service
npx @markbase/cli vault mount "Notes" ~/notes # give a vault a folder
npx @markbase/cli vault list                  # your vaults and where they are
npx @markbase/cli instance                    # which instance this machine uses
```

`login --app-url <url>` signs in to a self-hosted instance instead of
markbase.so. The CLI and the desktop app share one saved instance, so either
can move the other.
