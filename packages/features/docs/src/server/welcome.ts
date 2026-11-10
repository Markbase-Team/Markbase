import { markdownToDoc, docToMarkdown, deriveTitle } from "../logic/markdown";
import { createDocument } from "./documents";
import { createComment } from "./comments";
import type { DocJSON } from "../logic/types";

// The first document a new account sees: a copy of its own, in its first
// vault (see seedWelcomeDoc). It is a normal document — fully editable and
// deletable, and the text says so.
//
// It used to be ONE shared document for everybody, with each new user granted
// commenter access on first sign-in. That document was hard-deleted at some
// point (the text invites its owner to delete it) and the pointer to it in
// docs.app_config was left dangling, so every account that signed up after
// that received nothing — and the desktop app's sign-in never reached the
// seeding route at all. A copy in the account's own vault has neither problem:
// it arrives as a file in the folder they just mounted, and nobody else can
// take it away.
const WELCOME_MARKDOWN = `# Welcome to Markbase 👋

This is your first document — **Google Docs for markdown**, that your AI agents can read and write too. Edit it, or delete it — it's yours.

## Try it

Click anywhere and start typing. Press **/** for a menu of blocks — headings, lists, tables, and more. Everything saves automatically, with full version history.

## What makes it special

- **Edit by chatting.** Connect Claude and just say *"tighten the intro"* — it makes precise, minimal edits instead of rewriting the whole thing.
- **Tabs.** One document can hold many tabs — clean sections you can point an agent at (there's a comment on this one explaining how).
- **Comments.** Highlight any passage and leave a comment — ask a question, flag a blocker, or reply in a thread. Agents can comment too (say, to ask you to clarify) and mark them resolved when the point is settled.
- **History.** Every change is versioned — roll back to any past version anytime.
- **Share.** Invite people or hand out a link — they can read, comment, or edit.
- **Publish to web.** Turn any doc into a public page in one click — clean, server-rendered HTML that's great for **SEO** (Google) and **GEO** (AI answers like ChatGPT, Perplexity, and Claude). You decide when to publish or take it back offline.

## Connect Claude (~1 minute)

Give Claude access to your docs — from **Claude Desktop** or **Claude Code**:

\`\`\`bash
npx @markbase/cli@latest mcp install
\`\`\`

A browser opens — approve — then restart your app. Now ask Claude to *"list my Markbase docs"* or *"edit this one."*

## Keeping it up to date

The worker is a long-running process: publishing a new version doesn't restart it, so it keeps running the code it started with. To upgrade, reinstall the service from the new version (pin it — \`@latest\` can reuse a cached copy):

\`\`\`bash
npx -y @markbase/cli@latest uninstall-service
npx -y @markbase/cli@latest install-service
\`\`\`

The **Agents** page warns you when your worker is offline or out of date.

## Safe by design 🔒

An agent only ever sees documents you own or are shared on — never anyone else's. Want to limit one? Give its key a **viewer** or **commenter** ceiling in the dashboard → API keys.

---

Done reading? **Delete this doc** anytime with the trash icon on the documents list — it won't come back.
`;

// Real comments seeded on the welcome doc — a new user sees the comment feature
// in action, and each one explains a feature. { needle } is the bullet text the
// comment anchors to.
const SEED_COMMENTS: { needle: string; body: string }[] = [
  {
    needle: "Tabs",
    body: `👋 Tabs let you cleanly section a document. Each tab has its own id, so an agent can reference a specific tab and tell which one holds the more important tasks. An agent can also create a new tab for specific content or a purpose — for example, keep a product design in one tab and an action plan in another.`,
  },
  {
    needle: "Comments",
    body: `💬 Comments are the perfect place for an agent to weigh in without changing the document directly — leave a question, a suggestion, or a note here instead of editing the text, so you stay in control of the doc and decide what to act on.`,
  },
];

type PMNode = ReturnType<typeof markdownToDoc>;

// First position range where `needle` appears in the doc's text, in ProseMirror
// coordinates — used to anchor the seeded comment to the "Tabs" bullet.
function findAnchor(
  doc: PMNode,
  needle: string
): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (hit) return false;
    if (node.isText && node.text) {
      const i = node.text.indexOf(needle);
      if (i >= 0) {
        hit = { from: pos + i, to: pos + i + needle.length };
        return false;
      }
    }
    return true;
  });
  return hit;
}

// The seeded sample comments (from "Markbase"), anchored to their bullets.
async function seedComments(
  doc: PMNode,
  docId: string,
  version: number
): Promise<void> {
  for (const { needle, body } of SEED_COMMENTS) {
    try {
      const anchor = findAnchor(doc, needle);
      await createComment({
        docId,
        quotedText: needle,
        anchorFrom: anchor?.from ?? 0,
        anchorTo: anchor?.to ?? 0,
        anchorVersion: version,
        body,
        author: { kind: "agent", name: "Markbase" },
      });
    } catch {
      // Non-fatal — skip this sample comment.
    }
  }
}

/** Where the copy lands in the vault folder. */
export const WELCOME_DOC_PATH = "Welcome to Markbase.md";

/**
 * Put a Welcome document into `vaultId`, owned by `userId`.
 *
 * Called when an account creates its FIRST vault — the one moment a new
 * account has somewhere for a document to live, and the moment it is looking
 * at an empty folder. Not on sign-in (there is no vault yet) and not for a
 * second vault (the person has seen it). The sample comments are seeded on it,
 * so the comment feature is met in use rather than described.
 */
export async function seedWelcomeDoc(userId: string, vaultId: string): Promise<void> {
  const doc = markdownToDoc(WELCOME_MARKDOWN);
  const row = await createDocument({
    title: deriveTitle(WELCOME_MARKDOWN) ?? "Welcome",
    doc_json: doc.toJSON() as DocJSON,
    content: docToMarkdown(doc),
    owner_id: userId,
    vault_id: vaultId,
    path: WELCOME_DOC_PATH,
  });
  await seedComments(doc, row.id, row.version);
}
