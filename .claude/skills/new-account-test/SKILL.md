---
name: new-account-test
description: The end-to-end account scenarios for a self-hosted Markbase instance — the first account on a fresh instance, the first invited teammate (through the desktop app and in the browser), and a new account creating vaults — each with the exact steps, what must be seen, and how to check it. Use when asked to test sign-up, invites, joining, or vault creation, or after changing any of those flows; it starts from the clean state the markbase-dev-test skill provides.
---

# New account scenarios

Start every run from a clean state (see the `markbase-dev-test` skill):

```bash
.claude/skills/markbase-dev-test/scripts/reset-local-stack.sh --yes
.claude/skills/markbase-dev-test/scripts/reset-desktop-app.sh --yes
```

The reset prints the instance's invite link, `http://localhost:3100/join?code=…`.
Keep the code; every scenario needs it. Use a private window for every
"someone new" step, and record each test account's password in a scratchpad
file, not in the conversation.

## A. The first account on a fresh instance

The instance has no accounts, so the link alone admits — nobody is there to
invite anyone.

1. Open the invite link in a private window. Expect: **Join localhost:3100**,
   a lime **Open in desktop app** button, **Download for Mac**, and at the
   bottom **No desktop app? Create your account in the browser**. No
   "Signed in as" line, ever.
2. Click **Create your account in the browser** → `/signup?code=…`. Expect:
   **Create your account on localhost:3100**, "Use the address your teammate
   invited", email + password, **Already have one? Log in**.
3. Create `first-<date>@example.com`. Expect: signed in, landing on the
   dashboard with the first-vault prompt.
4. Checks: `auth.users` has one row; `instance_invites` is empty (the first
   account was not on the list, by design); the log shows no error.

Negative: with an account now present, a second sign-up through the same
link with an address nobody added must be refused — `POST /api/v1/instance/join`
answers 403 "That address has not been invited…".

## B. The first invited teammate

1. As the first account, open **Settings** (account row at the bottom of the
   sidebar). Expect: **Invite your team** — an address field with **Add**,
   then the join link with **Copy** and **New link**. No dividers in the
   dialog.
2. Add `invited-<date>@example.com`. Expect: it appears as a chip with an
   **X**; adding the same address again is a no-op; adding one that already
   has an account says so.
3. Check: `instance_invites` has the row, `accepted_at` null.

Then the teammate joins, one of two ways.

**Through the desktop app** (the main path):

4. Open the invite link in a private window and press **Open in desktop app**.
   The app asks **Join localhost:3100?** with "where you create your account"
   (or, if the app is already on 3100 and signed out, skips the question).
5. The app restarts on the instance and its window shows **Create your
   account on localhost:3100**. Enter the invited address and a password.
6. Expect: the window returns to the dashboard signed in as that address;
   `settings.json` has `apiKey` and `ownerId` and no `pendingInviteCode`;
   the log says `starting — … app at http://localhost:3100`; Settings shows
   **Instance … localhost:3100** and **Invite your team**.
7. Back in the first account's Settings, the chip for that address is gone;
   `instance_invites.accepted_at` is set.

**In the browser** (no app):

4. Private window → invite link → **Create your account in the browser** →
   the invited address + password. Expect: dashboard, signed in.

Negative: an address that was added and then withdrawn (the chip's X) is
refused at sign-up; a rotated link (**New link**) refuses the old code with
"That invite link is not valid any more".

## C. A new account creating vaults

Signed in as the invited account (desktop app, on the instance):

1. The dashboard offers **Create your first vault**. Expect the dialog's
   **Local folder** row to read "Defaults to ~/Markbase/<name>".
2. Create "Team notes" without picking a folder. Expect: the vault appears in
   the sidebar; `~/Markbase/Team notes` exists; the log shows `[Team notes]
   syncing …`; `~/.markbaseConfig/locks/<vaultId>.json` holds the app's pid.
3. Create a second vault and **pick** a folder that already belongs to the
   first (`~/Markbase/Team notes`). Expect: the refusal dialog ("That folder
   already belongs to another vault…") **at the pick**, the dialog's inline
   "That folder can't hold this vault. Pick another, or leave it to the
   default.", and **no vault created** yet. Pressing Create afterwards makes
   the vault at its default folder.
4. Create a document in each vault; expect the markdown file to appear in the
   folder within a few seconds, and an edit to the file to show in the app.
5. In the browser, signed in as the same account on http://localhost:3100,
   both vaults and their documents are there.

Checks: `select name from public.vaults`-style queries depend on the schema;
the reliable view is the app's sidebar plus the folders on disk plus the
instance log.

## Reporting

Say which scenario and step failed, what was on screen (screenshot over CDP
for the app, the browser pane for the web), the instance log lines around it,
and whether the state was clean when the run started.
