"use client";

import type { EditorSelection } from "./doc-editor";
import { CrdtComments } from "./crdt-comments";

// Comments for every role — viewers, commenters, editors, guests, and agents.
// Documents keep their comments in the doc's own Y.Doc (roadmap B1), so the panel
// reads and writes them client-side through the CRDT. `canComment` gates writing.
export function CommentsPanel({
  docId,
  canComment,
  selection,
  onQuoteClick,
  user,
}: {
  docId: string;
  canComment: boolean;
  selection: EditorSelection | null;
  // Jump the editor to a comment's quoted text. Omitted where there's no editor
  // (e.g. a guest-only view without the document surface).
  onQuoteClick?: (quote: string) => void;
  /** The signed-in author, for CRDT comments (written client-side, not via the API). */
  user?: { name: string; id: string | null };
}) {
  return (
    <CrdtComments
      docId={docId}
      canComment={canComment}
      selection={selection}
      user={user ?? { name: "", id: null }}
      onQuoteClick={onQuoteClick}
    />
  );
}
