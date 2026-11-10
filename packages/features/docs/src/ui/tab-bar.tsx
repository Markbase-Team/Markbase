"use client";

import { useState } from "react";
import { useNavigation } from "@markbase/ui/navigation";
import { useDocsRouting } from "./routing";
import { Check, Copy, GripVertical, X } from "lucide-react";
import { cn } from "@markbase/ui/utils";
import { useDocFetch } from "./doc-client";

export type Tab = { id: string; title: string };

// Copies a tab's id to the clipboard, with a brief check-mark confirmation.
function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // clipboard unavailable — ignore
        }
      }}
      className="shrink-0 text-muted-foreground hover:text-foreground"
      aria-label="Copy tab id"
      title="Copy id"
    >
      {copied ? (
        <Check className="size-3 text-emerald-600" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );
}

// The "Tabs" section of the side panel: the document's tabs, newest on top. The
// current tab (scroll-spy) is highlighted; clicking jumps to its section. "+"
// adds a tab (placed on top), "×" deletes one (never the last).
export function TabsPanel({
  docId,
  tabs,
  activeTabId,
  editable,
  onJump,
}: {
  docId: string;
  tabs: Tab[];
  activeTabId: string;
  editable: boolean;
  onJump: (tabId: string) => void;
}) {
  const { push, refresh } = useNavigation();
  const { docUrl } = useDocsRouting();
  const docFetch = useDocFetch();
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // Drag a tab onto another to reorder; persist the new order, then refresh so
  // both the panel list and the stacked sections pick up the new positions.
  async function reorder(draggedId: string, targetId: string) {
    if (busy || draggedId === targetId) return;
    const ids = tabs.map((t) => t.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setBusy(true);
    try {
      const res = await docFetch(`/api/v1/docs/${docId}/tabs`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: ids }),
      });
      if (res.ok) refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteTab(tabId: string) {
    if (busy || tabs.length <= 1) return;
    if (!confirm("Delete this subtab? Its content and comments are removed.")) return;
    setBusy(true);
    try {
      const res = await docFetch(`/api/v1/docs/${docId}/tabs/${tabId}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      if (tabId === docId) {
        const next = tabs.find((t) => t.id !== tabId);
        if (next) push(docUrl(next.id, null));
      } else {
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    // No "New subtab" here for now: the vault daemon mirrors one tab per
    // file, so a second tab is content that never reaches the folder. Groups
    // that already have tabs keep them (and can still drop them) until the
    // daemon can represent a whole group on disk.
    <div className="space-y-0.5 text-sm">
      {tabs.map((t) => (
        <div
          key={t.id}
          draggable={editable && !busy}
          onDragStart={() => setDragId(t.id)}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
          onDragOver={(e) => {
            if (dragId && dragId !== t.id) {
              e.preventDefault();
              setOverId(t.id);
            }
          }}
          onDragLeave={() =>
            setOverId((o) => (o === t.id ? null : o))
          }
          onDrop={() => {
            if (dragId) void reorder(dragId, t.id);
            setDragId(null);
            setOverId(null);
          }}
          className={cn(
            "group rounded px-2 py-1.5",
            editable && "cursor-grab",
            t.id === activeTabId ? "bg-muted font-medium" : "hover:bg-muted/60",
            dragId === t.id && "opacity-50",
            overId === t.id && "ring-2 ring-foreground/25"
          )}
        >
          <div className="flex items-center gap-1">
            {editable && (
              <GripVertical className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            )}
            <button
              type="button"
              onClick={() => onJump(t.id)}
              className="min-w-0 flex-1 truncate text-left"
            >
              {t.title || "Untitled"}
            </button>
            {editable && tabs.length > 1 && (
              <button
                type="button"
                onClick={() => deleteTab(t.id)}
                className="shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-destructive"
                aria-label="Delete subtab"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-normal text-muted-foreground">
              {t.id}
            </span>
            <CopyIdButton id={t.id} />
          </div>
        </div>
      ))}
    </div>
  );
}
