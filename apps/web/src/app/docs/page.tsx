import { Markdown } from "@markbase/ui/markdown";
import { SiteHeader } from "@/components/site-header";

export const metadata = {
  title: "Docs — Markbase",
  description:
    "What Markbase syncs, what a vault is, how shared documents reach a teammate's machine, how a team keeps its knowledge next to its code, and how to run your own instance.",
};

// The site's documentation page: one long read, as markdown, through the same
// renderer the app uses for documents. What it says has to match the code —
// the vault package decides what syncs, docs/shared-vault.md what a shared
// document does on disk, SELF-HOSTING.md how an instance is run — so when one
// of those changes, this page changes with it.
const CONTENT = `# Markbase docs

Markbase is a folder of markdown that syncs. You and your team edit the files in
the folder, in the browser, in the desktop app, or through the agents you already
run, and everyone sees one version. Comments, history and sharing sit on top of
plain files, so nothing is locked in: the folder is yours, and it keeps working
without us.

## Formats

**Markdown, one file per document.** A vault syncs the \`.md\` files in its
folder: headings, lists, task lists, tables, code blocks, links, images, in
GitHub-flavoured markdown. Front matter you wrote stays as you wrote it. Two
keys are added to each synced file's front matter, \`markbase_id\` and
\`markbase_version\`, which is how a document survives a rename or a move: file
it wherever you like, it is still the same document.

**Images travel with the text.** An image a document references,
\`![diagram](assets/diagram.png)\`, is uploaded with it and downloaded wherever
the vault is mounted, so the folder renders offline, in any editor. Assets are
compared by content, never by name.

**Everything else is left alone.** PDFs, an Obsidian workspace, \`.DS_Store\`:
a vault sits next to them and never touches them. Dotfiles and dot-folders are
never synced. A \`.markbaseignore\` at the vault root says what else to skip; it
is seeded with the usual suspects (\`node_modules\`, \`dist\`, \`build\`) and it
travels with the folder, so a vault inside a code repository stays a vault of
your notes, not of every README under \`node_modules\`.

## Vaults

A **vault** is a set of documents in the cloud and, on each machine you mount
it, **one folder** that mirrors them. Mount it from the desktop app (New vault,
or the Vaults menu) or from the terminal:

\`\`\`bash
npx @markbase/cli vault mount ~/Code/my-app/docs
\`\`\`

From then on a background sync keeps the folder and the cloud in step, both
ways: save a file and it is in the browser; edit in the browser and the file
changes. Two people, or a person and an agent, editing the same document at
once are merged rather than overwritten. Think of it as git without push and
pull.

The first vault defaults to \`~/Markbase/<name>\`. A folder belongs to exactly
one vault, and a vault to one account, so a folder that is already a vault, or
sits inside one, is refused for a second; the app says so the moment you pick
it. Deleted documents are moved to a \`.trash\` folder inside the vault, not
lost. The vault's own state lives in a hidden \`.markbase\` folder you can
ignore.

In the browser and in the app, every document has comments anchored to its
text, a history of versions, and a share menu: a public link, or named people
with viewer, commenter or editor access.

## Shared vaults

You share **documents**, not folders. A document shared with you does not land
in one of your own vaults, because its folder is the owner's; it lands in your
**Shared Vault**, a folder of your own, \`~/Markbase/shared\` by default, laid
out by owner and title: \`<owner>/<title>.md\`. The same sync keeps it in step,
and you can rearrange your copy however you like without moving the owner's
file.

What you can do with the file follows what you were given. An **editor**'s
edits merge into the document like anyone else's. A **viewer**'s or
**commenter**'s file is written read-only; an editor that writes to it anyway
keeps a private fork that never saves, and becomes a normal edit the day you
are made an editor. Deleting the file leaves the share and touches nothing of
the owner's. A new file dropped into the Shared Vault is left alone: there is no
owner to create it for.

## Working next to the code

The way we expect a team to work is to **keep the vault in the repository**,
beside the code it describes: the \`docs/\` folder, or the repository root with
\`node_modules\` and the build output in \`.markbaseignore\`. The markdown is
committed like any other file; the vault adds live sync, comments and sharing
on top, and takes nothing away.

- **Engineers and agents** work in the working tree. \`CLAUDE.md\`,
  \`AGENTS.md\`, the spec, the decision records and the runbooks are plain
  files, so Claude Code, Codex or any editor read and write them in place; the
  sync daemon holds the only key, and the agent needs none.
- **Product managers and designers** open the same documents in the browser
  or the desktop app, write the requirement and the handoff notes there, and
  leave comments on the exact line.
- **Everyone, and every agent, reads one version.** The spec an engineer's
  agent builds from this afternoon is the one the PM edited this morning, with
  the designer's notes in it and the questions resolved in the margin.

For teammates, share the documents the team works in and they land in each
person's Shared Vault, next to their own code and notes. On a self-hosted
instance the whole team is on one server of yours, which is the next section.

## Self-hosting

A team can run its own Markbase: one URL, the way a self-hosted Grafana is one
URL. The same build serves markbase.so and every instance; what makes an
instance invite-only is simply that it is not markbase.so.

1. **A Supabase project you own**, with this repository's migrations applied
   (\`npx supabase@2 db push\`). Markbase uses Supabase's auth, realtime,
   storage and cron, so any Supabase works, on supabase.com or self-hosted;
   a bare Postgres does not.
2. **The server**, one of two ways: a single Docker container on your machine
   (\`docker compose up --build -d\` with a \`.env\`), or the web app deployed
   to Vercel with root directory \`apps/web\` and the same five environment
   variables.
3. **The first account is the admin's.** Open the instance right after the
   first start and you get a set-up page: email, password, no invite needed.
   While the instance has no accounts that page is open to whoever reaches it,
   and the account it creates is recorded as the admin, so do it straight
   away. Then turn public sign-up off in the Supabase project.
4. **Invite the team** from Settings → Invite your team: add a teammate's
   address, then send them the join link. Nothing is mailed; the link goes in
   whatever channel you use. It creates an account only for an address on the
   list, and **New link** retires every link sent so far.
5. **Teammates open the link.** It points their desktop app at the instance,
   where they create their account and are in; the terminal way in is
   \`npx @markbase/cli login --app-url https://markbase.example.com\`.

The full guide, with every variable, the Supabase settings and the scheduled
jobs, is [SELF-HOSTING.md](https://github.com/Markbase-Team/Markbase/blob/main/SELF-HOSTING.md)
in the repository.

## Releases

What changed in each version of the desktop app is on the
[releases page](/releases).
`;

export default function DocsPage() {
  return (
    <div className="min-h-svh bg-white text-zinc-900">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="max-w-3xl">
          <Markdown content={CONTENT} />
        </div>
      </main>
    </div>
  );
}
