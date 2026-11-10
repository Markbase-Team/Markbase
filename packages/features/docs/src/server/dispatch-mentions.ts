import { createAgentMessageRequest, getAgentSessionById } from "@markbase/protocol";
import { parseMentions, stripMentionSyntax } from "@markbase/docs";
import type { Actor, DocumentRow } from "@markbase/docs/server";
import { featureEnabled } from "@markbase/node/features";

// When a comment @mentions an agent session, queue a message for the local
// worker, which resumes that Claude session so it can reply with its own comment.
//
// Best-effort: a mention that can't be delivered (dead session, non-Claude
// provider, no worker) must never fail the comment itself.
export async function dispatchMentions(input: {
  docId: string;
  doc: DocumentRow;
  comment: { id: string; body: string };
  author: Actor;
}): Promise<void> {
  const { docId, doc, comment, author } = input;

  // Loop guard: an agent's reply is itself a comment. If it mentions someone
  // (or itself), we'd bounce forever. Only humans and guests trigger delivery.
  if (author.kind === "agent") return;

  const ids = parseMentions(comment.body);
  if (ids.length === 0) return;

  // Agent sessions belong to the document's owner, not the commenter (who may be
  // a guest on a share link).
  const ownerId = doc.owner_id;
  if (!ownerId) return;

  // Delivery means resuming `claude` on the owner's machine. If they don't have
  // it, the mention still renders as a chip — it just never wakes anyone.
  if (!(await featureEnabled("mentionReply", ownerId))) return;

  const readable = stripMentionSyntax(comment.body).trim();

  for (const sessionId of ids) {
    try {
      const session = await getAgentSessionById(ownerId, sessionId);
      if (!session) continue;
      // Only a live Claude Code session can be resumed by the worker.
      if (session.provider !== "claude_code") continue;
      if (session.status !== "active" && session.status !== "idle") continue;
      if (!session.external_session_id) continue;

      await createAgentMessageRequest({
        ownerId,
        agentSessionId: session.id,
        docId,
        commentId: comment.id,
        prompt: mentionPrompt({
          docId,
          docTitle: doc.title,
          commentId: comment.id,
          authorName: author.name,
          body: readable,
        }),
      });
    } catch {
      // one bad mention shouldn't stop the others, or the comment
    }
  }
}

// What the resumed agent is told. It replies through the same doc API it already
// has (addComment), threaded under the comment that mentioned it.
function mentionPrompt(p: {
  docId: string;
  docTitle: string;
  commentId: string;
  authorName: string;
  body: string;
}): string {
  return [
    `You were @mentioned in a comment on the Markbase document "${p.docTitle}" (id: ${p.docId}).`,
    "",
    `${p.authorName} wrote:`,
    `"${p.body}"`,
    "",
    "Reply to them by adding a comment on that document:",
    `- use the addComment tool with id="${p.docId}" and parentId="${p.commentId}"`,
    "- answer directly and keep it short",
    "",
    "Read the document first (readDoc) if you need context. Do not edit the document.",
  ].join("\n");
}
