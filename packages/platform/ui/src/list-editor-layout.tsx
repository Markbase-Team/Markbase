"use client";

import { useState } from "react";
import { ArrowLeft, Check, Loader2, Plus } from "lucide-react";
import { Button } from "@markbase/ui/button";
import { cn } from "@markbase/ui/utils";
import { useIsMobile } from "@markbase/ui/use-mobile";

export type SaveStatus = "idle" | "saving" | "saved";

// Shared "Saving…/Saved" pill for autosaved editors.
export function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="size-3" />
        Saved
      </span>
    );
  }
  return null;
}

// A full-height master/detail editor: a clean left sidebar listing items + a
// main section editing the selected one (no card chrome — just a divider).
// Used by Documentation and Work Logs.
//
// Desktop: sidebar + main side by side. Mobile: the list, then the selected
// item full-screen with a back button. `onAdd` returns the new item's id so
// it's selected (and on mobile, opened) immediately.
export function ListEditorLayout<T extends { id: string }>({
  items,
  adding,
  onAdd,
  addLabel,
  titleFor,
  subtitleFor,
  emptyTitle = "Untitled",
  emptyDetail,
  renderDetail,
}: {
  items: T[];
  adding: boolean;
  onAdd: () => Promise<string | undefined>;
  addLabel: string;
  titleFor: (item: T) => string;
  subtitleFor?: (item: T) => string | undefined;
  emptyTitle?: string;
  emptyDetail: React.ReactNode;
  renderDetail: (item: T) => React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Effective selection, derived (no setState-in-effect): on desktop default to
  // the first item and fall back to it if the selected one vanished; on mobile
  // leave it null so the list shows until the user taps in.
  const selectedValid = selectedId !== null && items.some((i) => i.id === selectedId);
  const effectiveId = selectedValid
    ? selectedId
    : isMobile
      ? null
      : items[0]?.id ?? null;
  const selected = items.find((i) => i.id === effectiveId) ?? null;

  const handleAdd = async () => {
    const id = await onAdd();
    if (id) setSelectedId(id);
  };

  const addButton = (
    <Button onClick={handleAdd} disabled={adding} size="sm" className="w-full">
      {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      {addLabel}
    </Button>
  );

  const list = (
    <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto py-1">
      {items.length === 0 ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">Nothing yet.</p>
      ) : (
        items.map((it) => {
          const sub = subtitleFor?.(it);
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => setSelectedId(it.id)}
              className={cn(
                "block w-full rounded-md px-2 py-1.5 text-left",
                it.id === effectiveId
                  ? "bg-muted font-medium text-foreground"
                  : "text-foreground/80 hover:bg-muted/60"
              )}
            >
              <span className="block truncate text-sm">
                {titleFor(it) || emptyTitle}
              </span>
              {sub && (
                <span className="block truncate text-xs text-muted-foreground">
                  {sub}
                </span>
              )}
            </button>
          );
        })
      )}
    </nav>
  );

  const detail = selected ? (
    <div key={selected.id} className="flex h-full min-h-0 flex-col">
      {renderDetail(selected)}
    </div>
  ) : (
    emptyDetail
  );

  // Mobile: master → detail with a back button.
  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        {selected ? (
          <>
            <div className="shrink-0 pb-1">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
                All
              </button>
            </div>
            {detail}
          </>
        ) : (
          <>
            <div className="shrink-0 pb-1">{addButton}</div>
            {list}
          </>
        )}
      </div>
    );
  }

  // Desktop: clean sidebar + main, divided by a single border.
  return (
    <div className="flex h-full min-h-0 min-w-0">
      <aside className="flex w-56 shrink-0 flex-col border-r pr-3">
        <div className="shrink-0 pb-1">{addButton}</div>
        {list}
      </aside>
      <section className="min-h-0 min-w-0 flex-1 pl-4">{detail}</section>
    </div>
  );
}
