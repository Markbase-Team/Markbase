# Quick start

From nothing to a document that you, your teammates and your agent all edit.

## 1. Create an account

Sign up at [markbase.so](https://markbase.so/signup). The hosted app is free
to start. If your team runs its own instance, open the join link a teammate
sent you instead; see [Invite your team](/docs/invite-your-team).

## 2. Create a vault

Your first vault is offered as soon as you sign in. In the browser it holds
your documents in the cloud; give it a folder on your machine with the desktop
app or the CLI in the next step.

## 3. Sync it to a folder

**Desktop app (macOS, Apple silicon).** Download it from the
[releases page](/releases), open it, and sign in. New vaults go to
`~/Markbase/<name>` by default, or pick any folder that is not already a
vault. The first time, right-click the app and choose **Open**: the build is
not notarised yet.

**Or the CLI**, on any machine with Node.js:

```bash
npx @markbase/cli login
npx @markbase/cli vault mount "My vault" ~/Code/my-app/docs
```

`login` signs this machine in through the browser and installs the background
sync. `vault mount` gives a vault a folder; from then on the folder and the
cloud stay in step both ways.

## 4. Let your agent edit it

Point your agent at the folder and ask it to change a document. The file
changes, the sync sends the edit up, and it appears live in the browser. The
agent holds no credential: the sync does.

For agents that are not working on your disk, `npx @markbase/cli mcp install`
adds the document tools to Claude Desktop, Claude Code, Codex and Cursor. See
[Agents](/docs/agents).

## 5. Share it

Open a document in the browser and use **Share**: a public link, or named
people as viewers, commenters or editors. What they receive is covered in
[Sharing](/docs/sharing).
