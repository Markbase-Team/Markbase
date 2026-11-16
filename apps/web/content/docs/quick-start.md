# Quick start

From nothing to a document that you, your teammates and your agent all edit.
Pick one path: the desktop app on a Mac, or the CLI on any machine with
Node.js. Both start with an account and end in the same place, a folder that
stays in step with the cloud.

## Create an account

Sign up at [markbase.so](https://markbase.so/signup). The hosted app is free
to start. If your team runs its own instance, open the join link a teammate
sent you instead; see [Invite your team](/docs/invite-your-team).

## With the desktop app

### 1. Install and sign in

Download the app from the [releases page](/releases) (macOS, Apple silicon)
and open it. Sign in inside its window. On a self-hosted instance,
use the switcher in the top-right corner of the sign-in page first.

### 2. Create a vault

Press **New vault**. It creates the vault and its folder in one step, in
`~/Markbase/<name>` by default, or in any folder you pick that is not already
a vault. From then on the folder and the cloud stay in step both ways.

### 3. Let your agent edit it

Point your agent at the folder and ask it to change a document. The file
changes, the sync sends the edit up, and it appears live in the app and the
browser. The agent holds no credential: the sync does.

## With the CLI

### 1. Sign in

```bash
npx @markbase/cli login
```

signs this machine in through the browser and installs the background sync.
For a self-hosted instance, add `--app-url https://markbase.example.com`;
`npx @markbase/cli instance` shows which instance this machine uses. The CLI
and the desktop app share that setting, so either can move the other.

### 2. Mount a vault

```bash
npx @markbase/cli vault mount "My vault" ~/Code/my-app/docs
npx @markbase/cli vault list
```

`vault mount` gives a vault a folder; from then on the folder and the cloud
stay in step both ways. `vault unmount "My vault"` stops syncing on this
machine and leaves the files where they are. Documents others share with you
sync into a folder of their own:

```bash
npx @markbase/cli vault mount --shared ~/Markbase/shared
```

### 3. Connect your agent

An agent working in the folder needs nothing more: it edits the files and the
sync does the rest. For agents that are not working on your disk:

```bash
npx @markbase/cli mcp install
```

adds the document tools to Claude Desktop, Claude Code, Codex and Cursor
(`--desktop`, `--claude-code`, `--codex` or `--cursor` to pick one).

```bash
npx @markbase/cli skill install
```

installs the Markbase skill into `.claude/skills`, teaching an agent the HTTP
API. `markbase api <endpoint>` calls any endpoint directly; `markbase api
list` shows them all.

## Share it

Open a document and use **Share**: a link for people without an account, or
named people as viewers, commenters or editors. What they receive is covered
in [Sharing](/docs/sharing).
