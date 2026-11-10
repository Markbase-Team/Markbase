"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  Bell,
  Check,
  ChevronDown,
  Eraser,
  Inbox,
  Loader2,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type {
  AttentionBoard,
  AttentionItem,
  AttentionPriority,
} from "../server";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Textarea } from "@markbase/ui/textarea";
import { Label } from "@markbase/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@markbase/ui/dialog";
import { Kanban, type KanbanChange, type KanbanColumn } from "@markbase/ui/kanban";
import { ReaderModal, type ReaderSource } from "@markbase/ui/reader-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@markbase/ui/dropdown-menu";
import { cn } from "@markbase/ui/utils";

const PRIORITIES: {
  value: AttentionPriority;
  label: string;
  pill: string;
  dot: string;
}[] = [
  { value: "high", label: "High", pill: "bg-red-100 text-red-700", dot: "bg-red-500" },
  { value: "medium", label: "Medium", pill: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  { value: "low", label: "Low", pill: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
];

const stopDrag = (e: React.PointerEvent) => e.stopPropagation();

// A Gmail search hit, returned by /api/v1/attention/search and filed onto a
// board as a real email-backed card.
type EmailMatch = {
  account_id: string;
  message_id: string;
  thread_id: string | null;
  from: string;
  subject: string;
  snippet: string;
  date: string;
};

// Lower rank sorts higher (to the top of its column); unprioritized last.
const PRIORITY_RANK: Record<AttentionPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
function priorityRank(p: AttentionPriority | null): number {
  return p ? PRIORITY_RANK[p] : 3;
}

const API = "/api/v1/attention";

// Comma-separated text ⇄ string[] for the rule inputs.
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
function joinList(values: string[]): string {
  return values.join(", ");
}

function displayFrom(from: string): string {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match && match[1].trim()) return match[1].trim();
  if (match) return match[2].trim();
  return from;
}

type BoardDraft = {
  id: string | null;
  name: string;
  color: string;
  senderDomains: string;
  keywords: string;
  rules: string;
};

const NEW_DRAFT: BoardDraft = {
  id: null,
  name: "",
  color: "#e5ff6e",
  senderDomains: "",
  keywords: "",
  rules: "",
};

// The visual body of an item card — used both inside the sortable card and the
// drag overlay (the Kanban renders renderCard for both). Clicking the body
// opens the email in the reader modal; dragging (pointer move) starts a drag.
function ItemCard({
  item,
  onOpen,
  onApprove,
  onSetPriority,
  onDismiss,
}: {
  item: AttentionItem;
  onOpen: () => void;
  onApprove: (priority?: AttentionPriority) => void;
  onSetPriority: (priority: AttentionPriority | null) => void;
  onDismiss: () => void;
}) {
  const needsApproval = item.status === "needs_approval";
  const pr = PRIORITIES.find((p) => p.value === item.priority) ?? null;
  return (
    <div
      className={cn(
        "relative rounded-md border p-2.5 text-left",
        needsApproval ? "border-amber-300 bg-amber-50" : "bg-background"
      )}
    >
      {/* Clickable region — opens the reader modal. Not pointer-stopped, so a
          drag still starts from here (dnd-kit suppresses the click after a move). */}
      <button onClick={onOpen} className="block w-full cursor-pointer text-left">
        <p className="truncate pr-5 text-sm font-medium">
          {item.subject || "(no subject)"}
        </p>
        <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <Inbox className="size-3 shrink-0" />
          <span className="truncate">{displayFrom(item.from_addr)}</span>
        </p>
        {item.summary && (
          <p className="mt-1.5 text-xs leading-relaxed text-foreground/80">
            {item.summary}
          </p>
        )}
      </button>

      {/* Dismiss — removes from the board, marks read, and asks why. */}
      <button
        onPointerDown={stopDrag}
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
        className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>

      <div className="mt-2 flex items-center gap-2">
        {needsApproval ? (
          // Approve = pick a priority (and file). Plain "approve" also available.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="h-7 flex-1"
                onPointerDown={stopDrag}
              >
                <Check className="size-3.5" />
                Approve
                <ChevronDown className="ml-auto size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-40">
              {PRIORITIES.map((p) => (
                <DropdownMenuItem
                  key={p.value}
                  onSelect={() => onApprove(p.value)}
                >
                  <span className={cn("size-2 rounded-full", p.dot)} />
                  {p.label} priority
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onApprove(undefined)}>
                Approve, no priority
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          // Filed: show + change priority.
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onPointerDown={stopDrag}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  pr ? pr.pill : "bg-muted text-muted-foreground"
                )}
              >
                {pr ? (
                  <>
                    <span className={cn("size-2 rounded-full", pr.dot)} />
                    {pr.label}
                  </>
                ) : (
                  "Set priority"
                )}
                <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-36">
              {PRIORITIES.map((p) => (
                <DropdownMenuItem
                  key={p.value}
                  onSelect={() => onSetPriority(p.value)}
                >
                  <span className={cn("size-2 rounded-full", p.dot)} />
                  {p.label}
                </DropdownMenuItem>
              ))}
              {pr && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onSetPriority(null)}>
                    Clear priority
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// Bottom-right toast that captures a free-text reason so the model can tune the
// boards. Used after a dismissal (reason required to act) and after a cross-
// board drag (reason optional — the move itself is the signal).
function ReasonToast({
  toastId,
  title,
  description,
  placeholder,
  submitLabel = "Submit",
  requireReason = true,
  onSubmit,
}: {
  toastId: string | number;
  title: string;
  description?: string;
  placeholder?: string;
  submitLabel?: string;
  requireReason?: boolean;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="flex w-[340px] flex-col gap-2 rounded-lg border bg-background p-3 shadow-lg">
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <Textarea
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder={placeholder}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => toast.dismiss(toastId)}>
          Skip
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const r = reason.trim();
            toast.dismiss(toastId);
            if (!requireReason || r) onSubmit(r);
          }}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The attention boards.
 *
 * `renderItemActions` is a slot, and it exists so this package does not import
 * @markbase/email. Attention opens an email in the reader and knows an
 * "unsubscribe payload" came back with it, but it never looks inside that
 * payload — it stores it and hands it back. Whoever composes the two features
 * (apps/web) supplies the button and decides when to show it.
 *
 * Generic rather than a locally re-declared shape: duplicating email's type here
 * would leave two definitions free to drift apart with nothing checking them,
 * which is the nominal-linking hazard the Cordis paper calls out (§6.6). The
 * caller names the type — `<AttentionView<UnsubscribeInfo> …>` — and the default
 * keeps `<AttentionView />` valid for anyone who wants no actions at all.
 */
export function AttentionView<TUnsub = never>({
  renderItemActions,
}: {
  renderItemActions?: (ctx: {
    accountId: string;
    messageId: string;
    unsubscribe: TUnsub;
  }) => ReactNode;
} = {}) {
  const [boards, setBoards] = useState<AttentionBoard[]>([]);
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<BoardDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [approveBoardId, setApproveBoardId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AttentionItem | null>(null);
  const [viewerSource, setViewerSource] = useState<ReaderSource | null>(null);
  // Opaque here on purpose: see renderItemActions above.
  const [viewerUnsub, setViewerUnsub] = useState<TUnsub | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  // Snapshot of the last-cleared items per board, powering the header Undo.
  const [clearedByBoard, setClearedByBoard] = useState<
    Record<string, AttentionItem[]>
  >({});
  // "Add card" dialog: the target board id (null = closed) + fields. Two modes:
  // "manual" (type a card) and "email" (search Gmail and file a real email).
  const [addBoardId, setAddBoardId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<"manual" | "email">("manual");
  const [aiSubject, setAiSubject] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [aiPriority, setAiPriority] = useState<AttentionPriority | null>(null);
  const [aiSaving, setAiSaving] = useState(false);
  const [emailQuery, setEmailQuery] = useState("");
  const [emailResults, setEmailResults] = useState<EmailMatch[]>([]);
  const [emailSearching, setEmailSearching] = useState(false);
  const [filingId, setFilingId] = useState<string | null>(null);

  const columnEls = useRef<Record<string, HTMLDivElement | null>>({});
  // Latest boards, readable from toast action callbacks created earlier.
  const boardsRef = useRef<AttentionBoard[]>(boards);
  boardsRef.current = boards;

  // Open a board's settings dialog (used by the "View" action after feedback,
  // so you can see the freshly-edited rules).
  function openBoardSettings(boardId: string) {
    const b = boardsRef.current.find((x) => x.id === boardId);
    if (!b) return;
    setDraft({
      id: b.id,
      name: b.name,
      color: b.color,
      senderDomains: joinList(b.sender_domains),
      keywords: joinList(b.keywords),
      rules: b.rules,
    });
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(API);
      const data: {
        boards?: AttentionBoard[];
        items?: AttentionItem[];
        error?: string;
      } = await res.json();
      if (data.error) {
        toast.error(data.error);
        return;
      }
      setBoards(data.boards ?? []);
      setItems(data.items ?? []); // pre-sorted by position
    } catch {
      toast.error("Failed to load attention boards");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A drop that needs approval redirects here with ?approve=<boardId>. Capture
  // it (to scroll + emphasize that board), then strip the query. Re-loads so
  // the freshly-filed item shows up.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const approve = params.get("approve");
    if (approve) {
      setApproveBoardId(approve);
      window.history.replaceState({}, "", window.location.pathname);
      load();
    }
  }, [load]);

  useEffect(() => {
    if (!approveBoardId) return;
    const el = columnEls.current[approveBoardId];
    if (el) el.scrollIntoView({ behavior: "smooth", inline: "center" });
  }, [approveBoardId, boards]);

  // Open the email in the reader modal. The board only links to the email
  // (account_id + message_id), so the full body/HTML is fetched on demand from
  // the Inbox API — never stored on the attention item.
  async function openViewer(item: AttentionItem) {
    setViewing(item);
    setViewerSource(null);
    setViewerUnsub(null);
    if (!item.account_id || !item.message_id) {
      setViewerSource({ kind: "text", text: item.summary || item.snippet || "(no content)" });
      return;
    }
    setViewerLoading(true);
    try {
      const res = await fetch(
        `/api/v1/inbox/message?account=${item.account_id}&id=${item.message_id}`
      );
      const data: {
        message?: { html?: string; body?: string; unsubscribe?: TUnsub };
        error?: string;
      } = await res.json();
      if (data.error || !data.message) {
        setViewerSource({
          kind: "text",
          text: item.summary || item.snippet || "(no content)",
        });
      } else {
        setViewerSource({
          kind: "email",
          html: data.message.html,
          text: data.message.body,
        });
        setViewerUnsub(data.message.unsubscribe ?? null);
      }
    } catch {
      setViewerSource({
        kind: "text",
        text: item.summary || item.snippet || "(no content)",
      });
    } finally {
      setViewerLoading(false);
    }
  }

  // Approve a needs_approval card — files it, optionally with a priority.
  async function approveItem(id: string, priority?: AttentionPriority) {
    const prevItems = items;
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: "filed", priority: priority ?? i.priority }
          : i
      )
    );
    try {
      const res = await fetch(`${API}/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "filed", ...(priority ? { priority } : {}) }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prevItems);
      toast.error("Couldn't approve");
    }
  }

  async function setPriority(id: string, priority: AttentionPriority | null) {
    const prevItems = items;
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, priority } : i)));
    try {
      const res = await fetch(`${API}/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prevItems);
      toast.error("Couldn't set priority");
    }
  }

  // After a dismissal, ask the model to improve the boards from the user's
  // reason — either revising a board's rules or creating a better-matched one.
  async function submitFeedback(item: AttentionItem, reason: string) {
    const toastId = toast.loading("Tuning your boards…");
    try {
      const res = await fetch("/api/v1/attention/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: item.from_addr,
          subject: item.subject,
          snippet: item.snippet,
          summary: item.summary,
          reason,
          fromBoardId: item.board_id,
        }),
      });
      const data: {
        action?: string;
        board?: { id?: string; name?: string };
        explanation?: string;
        error?: string;
      } = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't apply feedback", { id: toastId });
        return;
      }
      await load();
      const view = data.board?.id
        ? { label: "View", onClick: () => openBoardSettings(data.board!.id!) }
        : undefined;
      if (data.action === "create_board") {
        toast.success(`Created “${data.board?.name}”`, {
          id: toastId,
          description: data.explanation,
          action: view,
        });
      } else if (data.action === "update_board") {
        toast.success(`Updated “${data.board?.name}” rules`, {
          id: toastId,
          description: data.explanation,
          action: view,
        });
      } else {
        toast.message(data.explanation ?? "No change made", { id: toastId });
      }
    } catch {
      toast.error("Couldn't apply feedback", { id: toastId });
    }
  }

  // Clear a board: remove all its cards (keeping a snapshot for Undo).
  async function handleClearBoard(boardId: string) {
    const cleared = items.filter((i) => i.board_id === boardId);
    if (cleared.length === 0) return;
    const name = boardsRef.current.find((b) => b.id === boardId)?.name ?? "board";
    setItems((cur) => cur.filter((i) => i.board_id !== boardId));
    setClearedByBoard((prev) => ({ ...prev, [boardId]: cleared }));
    try {
      const res = await fetch(`${API}/boards/${boardId}/clear`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      toast(`Cleared ${cleared.length} from ${name}`, {
        duration: 6000,
        action: { label: "Undo", onClick: () => undoClear(boardId, cleared) },
      });
    } catch {
      setItems((cur) => [...cleared, ...cur]);
      setClearedByBoard((prev) => {
        const next = { ...prev };
        delete next[boardId];
        return next;
      });
      toast.error("Couldn't clear board");
    }
  }

  // Undo a clear: re-insert the snapshot (header Undo button or toast action).
  // The snapshot is passed in so the toast action doesn't read stale state.
  async function undoClear(boardId: string, cleared: AttentionItem[]) {
    if (!cleared || cleared.length === 0) return;
    setItems((cur) => {
      const have = new Set(cur.map((i) => i.id));
      return [...cleared.filter((i) => !have.has(i.id)), ...cur];
    });
    setClearedByBoard((prev) => {
      const next = { ...prev };
      delete next[boardId];
      return next;
    });
    try {
      const res = await fetch(`${API}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: cleared }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems((cur) => cur.filter((i) => !cleared.some((c) => c.id === i.id)));
      toast.error("Couldn't undo");
    }
  }

  // Dismiss is deferred: the card vanishes immediately and an Undo toast shows
  // for a few seconds. Only if it isn't undone do we actually delete on the
  // server, mark the email read, and ask why it didn't belong. So undo just
  // cancels a pending action — nothing to restore from the server.
  function dismissItem(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setItems((cur) => cur.filter((i) => i.id !== id));

    let undone = false;
    let settled = false;
    const commit = () => {
      if (undone || settled) return;
      settled = true;
      void commitDismiss(item);
    };

    toast(`Dismissed “${item.subject || "(no subject)"}”`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          setItems((cur) =>
            cur.some((i) => i.id === item.id) ? cur : [item, ...cur]
          );
        },
      },
      onAutoClose: commit,
      onDismiss: commit,
    });
  }

  // Actually remove the item once the undo window passes: delete, mark read,
  // then ask why it didn't belong.
  async function commitDismiss(item: AttentionItem) {
    try {
      const res = await fetch(`${API}/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      // Put it back if the delete failed.
      setItems((cur) =>
        cur.some((i) => i.id === item.id) ? cur : [item, ...cur]
      );
      toast.error("Couldn't dismiss");
      return;
    }

    // Handled → mark the email read in Gmail. Warns if the account is read-only.
    if (item.account_id && item.message_id) {
      void fetch("/api/v1/inbox/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: item.account_id, id: item.message_id }),
      })
        .then((r) => {
          if (!r.ok) {
            toast.warning(
              "Dismissed, but couldn't mark it read — reconnect that account to allow it."
            );
          }
        })
        .catch(() => {});
    }

    // Ask why it didn't belong — the model tunes the boards from the answer.
    toast.custom(
      (tId) => (
        <ReasonToast
          toastId={tId}
          title="Why didn’t this belong here?"
          description="Optional — we’ll tune your boards from it."
          placeholder="e.g. this is a brokerage trade confirmation, not a bill"
          onSubmit={(reason) => submitFeedback(item, reason)}
        />
      ),
      { duration: 15000, position: "bottom-right" }
    );
  }

  // Persist a drag from the Kanban: board change (if any) + new column order.
  async function onKanbanChange({ itemId, from, to, moved, columns }: KanbanChange) {
    const item = items.find((i) => i.id === itemId);
    if (moved) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, board_id: to, status: "filed" } : i
        )
      );
    }
    try {
      const calls: Promise<Response>[] = [];
      if (moved) {
        calls.push(
          fetch(`${API}/items/${itemId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ board_id: to }),
          })
        );
      }
      calls.push(
        fetch(`${API}/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ boardId: to, orderedIds: columns[to] }),
        })
      );
      if (moved) {
        calls.push(
          fetch(`${API}/reorder`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ boardId: from, orderedIds: columns[from] }),
          })
        );
      }
      const results = await Promise.all(calls);
      if (results.some((r) => !r.ok)) throw new Error();

      // A cross-board move is a strong signal — offer to tune both boards.
      if (moved && item) {
        const fromName = boards.find((b) => b.id === from)?.name ?? "the old board";
        const toName = boards.find((b) => b.id === to)?.name ?? "the new board";
        toast.custom(
          (tId) => (
            <ReasonToast
              toastId={tId}
              title={`Moved to ${toName}`}
              description={`Update “${fromName}” and “${toName}” rules so emails like this sort here automatically? Add a note (optional).`}
              placeholder="e.g. brokerage trade confirmations belong here, not in bills"
              submitLabel="Update rules"
              requireReason={false}
              onSubmit={(reason) => submitMoveFeedback(item, from, to, reason)}
            />
          ),
          { duration: 15000, position: "bottom-right" }
        );
      }
    } catch {
      toast.error("Couldn't save changes");
      load();
    }
  }

  // Tune both boards' rules after a cross-board drag (reason optional).
  async function submitMoveFeedback(
    item: AttentionItem,
    fromBoardId: string,
    toBoardId: string,
    reason: string
  ) {
    const toastId = toast.loading("Updating both boards…");
    try {
      const res = await fetch("/api/v1/attention/move-feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: item.from_addr,
          subject: item.subject,
          snippet: item.snippet,
          summary: item.summary,
          reason,
          fromBoardId,
          toBoardId,
        }),
      });
      const data: {
        fromBoard?: { id?: string; name?: string };
        toBoard?: { id?: string; name?: string };
        explanation?: string;
        error?: string;
      } = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't update boards", { id: toastId });
        return;
      }
      await load();
      const names = [data.fromBoard?.name, data.toBoard?.name]
        .filter(Boolean)
        .join(" & ");
      toast.success(names ? `Tuned ${names} rules` : "Boards updated", {
        id: toastId,
        description: data.explanation,
        action: data.toBoard?.id
          ? { label: "View", onClick: () => openBoardSettings(data.toBoard!.id!) }
          : undefined,
      });
    } catch {
      toast.error("Couldn't update boards", { id: toastId });
    }
  }

  // Sweep all unread inbox emails through the classifier and link them into
  // boards. Emails already linked are skipped.
  async function classifyUnread() {
    setClassifying(true);
    const toastId = toast.loading("Classifying unread emails…");
    try {
      const res = await fetch("/api/v1/attention/classify-unread", {
        method: "POST",
      });
      const data: {
        total?: number;
        filed?: number;
        needsApproval?: number;
        skipped?: number;
        unmatched?: number;
        errored?: number;
        error?: string;
      } = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't classify unread", { id: toastId });
        return;
      }
      const {
        total = 0,
        filed = 0,
        needsApproval = 0,
        skipped = 0,
        unmatched = 0,
        errored = 0,
      } = data;
      if (total === 0) {
        toast.message("No unread emails to classify", { id: toastId });
      } else {
        const extras = [
          unmatched ? `${unmatched} left in inbox` : "",
          skipped ? `${skipped} already linked` : "",
          errored ? `${errored} failed — retry` : "",
        ].filter(Boolean);
        const tail = extras.length ? `, ${extras.join(", ")}` : "";
        toast.success(
          `Filed ${filed}, ${needsApproval} need approval${tail}`,
          { id: toastId }
        );
      }
      await load();
    } catch {
      toast.error("Couldn't classify unread", { id: toastId });
    } finally {
      setClassifying(false);
    }
  }

  function openAddItem(boardId: string) {
    setAddBoardId(boardId);
    setAddMode("manual");
    setAiSubject("");
    setAiSummary("");
    setAiPriority(null);
    setEmailQuery("");
    setEmailResults([]);
  }

  async function searchEmails() {
    const q = emailQuery.trim();
    if (!q) {
      toast.error("Type a Gmail search");
      return;
    }
    setEmailSearching(true);
    try {
      const res = await fetch("/api/v1/attention/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data: { results?: EmailMatch[]; error?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Search failed");
        return;
      }
      setEmailResults(data.results ?? []);
      if ((data.results ?? []).length === 0) toast.info("No matching emails");
    } finally {
      setEmailSearching(false);
    }
  }

  async function fileEmail(match: EmailMatch) {
    if (!addBoardId) return;
    setFilingId(match.message_id);
    try {
      const res = await fetch("/api/v1/attention/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board_id: addBoardId, ...match }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed" }));
        toast.error(error ?? "Couldn't file the email");
        return;
      }
      setAddBoardId(null);
      toast.success("Email filed to the board");
      await load();
    } finally {
      setFilingId(null);
    }
  }

  async function createItem() {
    if (!addBoardId) return;
    if (!aiSubject.trim()) {
      toast.error("A title is required");
      return;
    }
    setAiSaving(true);
    try {
      const res = await fetch("/api/v1/attention/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          board_id: addBoardId,
          subject: aiSubject,
          summary: aiSummary,
          priority: aiPriority,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed" }));
        toast.error(error ?? "Couldn't add the card");
        return;
      }
      setAddBoardId(null);
      toast.success("Card added");
      await load();
    } finally {
      setAiSaving(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("Board name is required");
      return;
    }
    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      color: draft.color,
      sender_domains: splitList(draft.senderDomains),
      keywords: splitList(draft.keywords),
      rules: draft.rules,
    };
    try {
      const res = draft.id
        ? await fetch(`${API}/boards/${draft.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`${API}/boards`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...payload, position: boards.length }),
          });
      if (!res.ok) throw new Error();
      toast.success(draft.id ? "Board updated" : "Board added");
      setDraft(null);
      await load();
    } catch {
      toast.error("Couldn't save board");
    } finally {
      setSaving(false);
    }
  }

  async function deleteBoard(id: string) {
    if (!window.confirm("Delete this board and all the emails filed under it?")) {
      return;
    }
    try {
      const res = await fetch(`${API}/boards/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Board deleted");
      setDraft(null);
      await load();
    } catch {
      toast.error("Couldn't delete board");
    }
  }

  // Priority-first ordering: prioritized cards rise to the top of their column.
  // Stable sort keeps each tier in its existing (drag/position) order.
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)),
    [items]
  );

  // Build the Kanban columns (header chrome) from boards + their items.
  const kanbanColumns: KanbanColumn[] = boards.map((board) => {
    const boardItems = items.filter((i) => i.board_id === board.id);
    const needsApproval = boardItems.some((i) => i.status === "needs_approval");
    return {
      id: board.id,
      accent: needsApproval,
      emptyLabel: "Drop an email here.",
      header: (
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: board.color }}
          />
          <span className="truncate text-sm font-semibold">{board.name}</span>
          {needsApproval && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              Needs approval
            </span>
          )}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {boardItems.length}
          </span>
          <button
            onClick={() => openAddItem(board.id)}
            title="Add a card by hand"
            aria-label="Add a card by hand"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
          {clearedByBoard[board.id]?.length ? (
            <button
              onClick={() => undoClear(board.id, clearedByBoard[board.id] ?? [])}
              title="Undo clear"
              aria-label="Undo clear"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Undo2 className="size-4" />
            </button>
          ) : null}
          {boardItems.length > 0 && (
            <button
              onClick={() => handleClearBoard(board.id)}
              title="Clear board"
              aria-label="Clear board"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Eraser className="size-4" />
            </button>
          )}
          <button
            onClick={() =>
              setDraft({
                id: board.id,
                name: board.name,
                color: board.color,
                senderDomains: joinList(board.sender_domains),
                keywords: joinList(board.keywords),
                rules: board.rules,
              })
            }
            title="Board settings"
            aria-label="Board settings"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Settings className="size-4" />
          </button>
        </div>
      ),
    };
  });

  return (
    <main className="flex h-full w-full min-w-0 flex-col px-3 py-3">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Bell className="size-5" />
          Attention
        </h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={classifyUnread}
            disabled={classifying}
          >
            {classifying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Classify unread
          </Button>
          <Button variant="outline" onClick={() => setDraft({ ...NEW_DRAFT })}>
            <Plus className="size-4" />
            Add board
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : boards.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
          <Bell className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No attention boards yet. Add one to start triaging emails.
          </p>
          <Button onClick={() => setDraft({ ...NEW_DRAFT })}>
            <Plus className="size-4" />
            Add board
          </Button>
        </div>
      ) : (
        <Kanban
          columns={kanbanColumns}
          items={sortedItems}
          getColumnId={(i) => i.board_id}
          onChange={onKanbanChange}
          className="rounded-xl bg-muted/40 p-3"
          columnClassName="shadow-sm"
          setColumnRef={(id, el) => {
            columnEls.current[id] = el;
          }}
          renderCard={(item) => (
            <ItemCard
              item={item}
              onOpen={() => openViewer(item)}
              onApprove={(priority) => approveItem(item.id, priority)}
              onSetPriority={(priority) => setPriority(item.id, priority)}
              onDismiss={() => dismissItem(item.id)}
            />
          )}
        />
      )}

      {/* Email reader — fetches the full email on demand (board only links). */}
      <ReaderModal
        open={!!viewing}
        onOpenChange={(open) => !open && setViewing(null)}
        title={viewing?.subject || "(no subject)"}
        loading={viewerLoading}
        source={viewerSource}
        actions={
          viewing?.account_id && viewing?.message_id && viewerUnsub
            ? renderItemActions?.({
                accountId: viewing.account_id,
                messageId: viewing.message_id,
                unsubscribe: viewerUnsub,
              })
            : undefined
        }
        meta={
          viewing && (
            <>
              <span>{viewing.from_addr}</span>
              {viewing.email_date && (
                <>
                  <span className="size-1 rounded-full bg-muted-foreground/40" />
                  <span>{formatDate(viewing.email_date)}</span>
                </>
              )}
            </>
          )
        }
      />

      {/* Add a card — by hand or from a Gmail search */}
      <Dialog
        open={!!addBoardId}
        onOpenChange={(open) => !open && setAddBoardId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a card</DialogTitle>
            <DialogDescription>
              Add to{" "}
              {boards.find((b) => b.id === addBoardId)?.name ?? "this board"} by
              hand, or find an email to file.
            </DialogDescription>
          </DialogHeader>

          {/* Mode toggle */}
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(["manual", "email"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAddMode(m)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  addMode === m
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "manual" ? "By hand" : "From email"}
              </button>
            ))}
          </div>

          {addMode === "manual" ? (
            <>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="ai-subject">Title</Label>
                  <Input
                    id="ai-subject"
                    value={aiSubject}
                    onChange={(e) => setAiSubject(e.target.value)}
                    placeholder="What needs attention?"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-summary">Note (optional)</Label>
                  <Textarea
                    id="ai-summary"
                    value={aiSummary}
                    onChange={(e) => setAiSummary(e.target.value)}
                    rows={3}
                    placeholder="Any details…"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <div className="flex flex-wrap gap-2">
                    {PRIORITIES.map((p) => {
                      const on = aiPriority === p.value;
                      return (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() => setAiPriority(on ? null : p.value)}
                          aria-pressed={on}
                          className={cn(
                            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                            on
                              ? cn("border-transparent", p.pill)
                              : "border-input text-muted-foreground hover:bg-muted"
                          )}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={createItem} disabled={aiSaving}>
                  {aiSaving ? <Loader2 className="size-4 animate-spin" /> : null}
                  Add card
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={emailQuery}
                  onChange={(e) => setEmailQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchEmails()}
                  placeholder="Gmail search, e.g. from:chase.com statement"
                />
                <Button
                  variant="outline"
                  onClick={searchEmails}
                  disabled={emailSearching}
                >
                  {emailSearching ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Search"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Raw Gmail links can&apos;t be looked up — search instead, then
                click a result to file it.
              </p>
              {emailResults.length > 0 && (
                <div className="max-h-[40vh] space-y-1.5 overflow-y-auto">
                  {emailResults.map((m) => (
                    <button
                      key={`${m.account_id}:${m.message_id}`}
                      type="button"
                      onClick={() => fileEmail(m)}
                      disabled={!!filingId}
                      className="flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.subject || "(no subject)"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.from}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.snippet}
                        </p>
                      </div>
                      {filingId === m.message_id ? (
                        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
                      ) : (
                        <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Board settings / add dialog */}
      <Dialog open={!!draft} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "Board settings" : "Add board"}
            </DialogTitle>
            <DialogDescription>
              Rules guide the model that sorts dropped emails. Domains and
              keywords are extra hints; the natural-language rules carry the
              intent.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="board-name">Name</Label>
                <Input
                  id="board-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Finance"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="board-color">Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="board-color"
                    type="color"
                    value={draft.color}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                    className="size-9 cursor-pointer rounded border bg-background"
                  />
                  <Input
                    value={draft.color}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                    className="w-28"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="board-senders">Sender domains (hints)</Label>
                <Input
                  id="board-senders"
                  value={draft.senderDomains}
                  onChange={(e) =>
                    setDraft({ ...draft, senderDomains: e.target.value })
                  }
                  placeholder="chase.com, paypal.com"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated. Passed to the model as context.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="board-keywords">Keywords (hints)</Label>
                <Input
                  id="board-keywords"
                  value={draft.keywords}
                  onChange={(e) =>
                    setDraft({ ...draft, keywords: e.target.value })
                  }
                  placeholder="statement, receipt, invoice"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated. Passed to the model as context.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="board-rules">Rules (natural language)</Label>
                <Textarea
                  id="board-rules"
                  value={draft.rules}
                  onChange={(e) => setDraft({ ...draft, rules: e.target.value })}
                  placeholder="Statements and receipts from Apple Card, Chase, or PayPal."
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter className="sm:justify-between">
            {draft?.id ? (
              <Button
                variant="outline"
                onClick={() => deleteBoard(draft.id!)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button onClick={saveDraft} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
