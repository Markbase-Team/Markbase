"use client";

import { useState } from "react";
import { Check, MessageSquarePlus, Send, Trash2, Undo2 } from "lucide-react";
import { cn } from "@markbase/ui/utils";
import { useDocComments } from "./use-doc-comments";
import type { CommentView } from "@markbase/docs";
import type { EditorSelection } from "./doc-editor";

// The document's comments (roadmap B1). Reads and writes the comments Y.Array in
// the document's own Y.Doc via useDocComments, so threads sync over the one
// channel, survive edits (relative-position anchors), and converge live. Agents
// still read/write comments through the Postgres REST API (comments endpoints).
export function CrdtComments({
  docId,
  canComment,
  selection,
  user,
  onQuoteClick,
}: {
  docId: string;
  canComment: boolean;
  selection: EditorSelection | null;
  user: { name: string; id: string | null };
  onQuoteClick?: (quote: string) => void;
}) {
  const { threads, loading, add, reply, resolve, remove } = useDocComments(docId, true, user);
  const [body, setBody] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const visible = threads.filter((t) => showResolved || !t.resolved);
  const hasResolved = threads.some((t) => t.resolved);

  function submit() {
    if (!selection || !add(selection.quote, body)) return;
    setBody("");
  }

  return (
    <div className="space-y-3 text-xs" data-testid="crdt-comments">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Comments</h3>
        {hasResolved && (
          <button
            type="button"
            onClick={() => setShowResolved((s) => !s)}
            className="text-muted-foreground hover:text-foreground"
          >
            {showResolved ? "Hide resolved" : "Show resolved"}
          </button>
        )}
      </div>

      {/* Composer — only with a selection, since a CRDT comment anchors to text. */}
      {canComment && (
        <div className="rounded-lg border p-2">
          {selection ? (
            <p className="mb-1.5 line-clamp-2 border-l-2 border-[#e5ff6e] pl-2 text-muted-foreground italic">
              {selection.quote}
            </p>
          ) : (
            <p className="mb-1.5 text-muted-foreground">Select text in the document to comment on it.</p>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!selection}
            placeholder={selection ? "Comment on the selection…" : ""}
            rows={2}
            className="w-full resize-none rounded border bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={!selection || !body.trim()}
              data-testid="add-comment"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#e5ff6e] px-3 py-1 font-semibold text-neutral-900 disabled:opacity-40"
            >
              <MessageSquarePlus className="size-3.5" />
              Comment
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground">Loading comments…</p>
      ) : visible.length === 0 ? (
        <p className="text-muted-foreground">No comments yet.</p>
      ) : (
        <ol className="space-y-2">
          {visible.map((t) => (
            <Thread
              key={t.id}
              thread={t}
              canComment={canComment}
              onQuoteClick={onQuoteClick}
              onResolve={() => resolve(t.id, !t.resolved)}
              onDelete={() => remove(t.id)}
              replyOpen={replyTo === t.id}
              onToggleReply={() => setReplyTo(replyTo === t.id ? null : t.id)}
              replyBody={replyTo === t.id ? replyBody : ""}
              onReplyBody={setReplyBody}
              onReply={() => {
                if (!replyBody.trim()) return;
                reply(t.id, replyBody);
                setReplyBody("");
                setReplyTo(null);
              }}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function Thread({
  thread,
  canComment,
  onQuoteClick,
  onResolve,
  onDelete,
  replyOpen,
  onToggleReply,
  replyBody,
  onReplyBody,
  onReply,
}: {
  thread: CommentView;
  canComment: boolean;
  onQuoteClick?: (quote: string) => void;
  onResolve: () => void;
  onDelete: () => void;
  replyOpen: boolean;
  onToggleReply: () => void;
  replyBody: string;
  onReplyBody: (v: string) => void;
  onReply: () => void;
}) {
  return (
    <li className={cn("rounded-lg border p-2", thread.resolved && "opacity-60")}>
      {/* The quoted span — click to jump to it in the document. Orphaned = its
          text was deleted, so it can't be located any more. */}
      {thread.quote && (
        <button
          type="button"
          onClick={() => !thread.orphaned && onQuoteClick?.(thread.quote)}
          className={cn(
            "mb-1.5 block w-full border-l-2 pl-2 text-left italic",
            thread.orphaned
              ? "border-muted text-muted-foreground line-through"
              : "border-[#e5ff6e] text-muted-foreground hover:text-foreground"
          )}
          title={thread.orphaned ? "The commented text was deleted" : "Jump to this text"}
        >
          {thread.quote}
        </button>
      )}
      <Body view={thread} />
      {thread.replies.map((r) => (
        <div key={r.id} className="mt-2 border-l pl-2">
          <Body view={r} />
        </div>
      ))}

      {canComment && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleReply}
            className="text-muted-foreground hover:text-foreground"
          >
            Reply
          </button>
          <button
            type="button"
            onClick={onResolve}
            className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            data-testid="resolve-comment"
          >
            {thread.resolved ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
            {thread.resolved ? "Reopen" : "Resolve"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete comment"
            className="text-muted-foreground hover:text-red-600"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}

      {replyOpen && (
        <div className="mt-2 flex items-end gap-1.5">
          <textarea
            value={replyBody}
            onChange={(e) => onReplyBody(e.target.value)}
            rows={1}
            placeholder="Reply…"
            className="w-full resize-none rounded border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={onReply}
            disabled={!replyBody.trim()}
            className="shrink-0 rounded-full bg-[#e5ff6e] p-1.5 text-neutral-900 disabled:opacity-40"
          >
            <Send className="size-3.5" />
          </button>
        </div>
      )}
    </li>
  );
}

function Body({ view }: { view: CommentView }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{view.authorName || "You"}</span>
        <span className="text-muted-foreground">{new Date(view.at).toLocaleString()}</span>
      </div>
      <p className="mt-0.5 break-words whitespace-pre-wrap">{view.body}</p>
    </div>
  );
}
