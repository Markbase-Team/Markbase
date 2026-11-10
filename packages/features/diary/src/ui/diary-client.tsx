"use client";

import { Trash2 } from "lucide-react";
import { MarkdownEditor } from "@markbase/ui/markdown-editor";
import { useDiary, type DiaryView } from "./use-diary";
import { ListEditorLayout, SaveIndicator } from "@markbase/ui/list-editor-layout";
import { AppHeader } from "@markbase/ui/app-header";

// Render a YYYY-MM-DD as a friendly local date, without the UTC shift that
// `new Date("YYYY-MM-DD")` would introduce.
function formatDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function DiaryClient() {
  const d = useDiary();

  return (
    <main className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader title="Learning Diary" />
      <div className="min-h-0 flex-1 px-3 py-3">
        <ListEditorLayout
          items={d.diaries}
          adding={d.adding}
          onAdd={d.addEntry}
          addLabel="New entry"
          titleFor={(e) => e.title || formatDate(e.entry_date)}
          subtitleFor={(e) => (e.title ? formatDate(e.entry_date) : undefined)}
          emptyTitle="Untitled"
          emptyDetail={
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Select an entry, or create one.
            </div>
          }
          renderDetail={(entry) => (
            <EntryDetail
              entry={entry}
              onField={(patch) => d.setField(entry.id, patch)}
              onRemove={() => d.remove(entry.id)}
            />
          )}
        />
      </div>
    </main>
  );
}

function EntryDetail({
  entry,
  onField,
  onRemove,
}: {
  entry: DiaryView;
  onField: (
    patch: Partial<Pick<DiaryView, "entry_date" | "title" | "content">>
  ) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <input
          value={entry.title}
          onChange={(e) => onField({ title: e.target.value })}
          placeholder="What did you learn?"
          aria-label="Entry title"
          className="min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60"
        />
        <input
          type="date"
          value={entry.entry_date}
          onChange={(e) => onField({ entry_date: e.target.value })}
          aria-label="Entry date"
          className="w-32 shrink-0 border-0 bg-transparent text-sm text-muted-foreground outline-none"
        />
        <SaveIndicator status={entry.status} />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Delete entry"
          title="Delete entry"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MarkdownEditor
          value={entry.content}
          onChange={(next) => onField({ content: next })}
          placeholder="Write your learning notes in markdown…"
          imagePrefix="diary"
        />
      </div>
    </>
  );
}
