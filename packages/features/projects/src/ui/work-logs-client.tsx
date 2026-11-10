"use client";

import { Trash2 } from "lucide-react";
import { MarkdownEditor } from "@markbase/ui/markdown-editor";
import { useProject, type WorkLog } from "./project-context";
import { ListEditorLayout, SaveIndicator } from "@markbase/ui/list-editor-layout";

// Per-project work logs: a nested list of logs + a full-height editing pane (the
// Crepe markdown editor). Dated logs show their date as a subtitle.
export function WorkLogsClient() {
  const {
    slug,
    workLogs,
    workLogAdding,
    addWorkLog,
    setWorkLogField,
    removeWorkLog,
  } = useProject();

  // Turn a selected block into a ticket in this project. A small model extracts
  // the ticket fields server-side; we return the new ticket's id so the editor
  // can drop a live chip linking to it.
  const taskify = async (text: string): Promise<{ id: string } | null> => {
    try {
      const res = await fetch(
        `/api/admin/projects/${encodeURIComponent(slug)}/taskify`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        }
      );
      const data: { ticket?: { id: string }; error?: string } =
        await res.json();
      if (!res.ok || !data.ticket) throw new Error(data.error ?? "Failed");
      return data.ticket;
    } catch {
      return null;
    }
  };

  return (
    <ListEditorLayout
      items={workLogs}
      adding={workLogAdding}
      onAdd={addWorkLog}
      addLabel="New log"
      titleFor={(l) => l.title}
      subtitleFor={(l) => l.entry_date ?? undefined}
      emptyTitle="Untitled log"
      emptyDetail={
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Select a log, or create one.
        </div>
      }
      renderDetail={(log) => (
        <LogDetail
          log={log}
          onField={(patch) => setWorkLogField(log.id, patch)}
          onRemove={() => removeWorkLog(log.id)}
          onTaskify={taskify}
        />
      )}
    />
  );
}

function LogDetail({
  log,
  onField,
  onRemove,
  onTaskify,
}: {
  log: WorkLog;
  onField: (
    patch: Partial<Pick<WorkLog, "entry_date" | "title" | "content">>
  ) => void;
  onRemove: () => void;
  onTaskify: (selectedText: string) => Promise<{ id: string } | null>;
}) {
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <input
          value={log.title}
          onChange={(e) => onField({ title: e.target.value })}
          placeholder="Untitled log"
          aria-label="Log title"
          className="min-w-0 flex-1 border-0 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/60"
        />
        <input
          type="date"
          value={log.entry_date ?? ""}
          onChange={(e) => onField({ entry_date: e.target.value || null })}
          aria-label="Log date (optional)"
          className="w-32 shrink-0 border-0 bg-transparent text-sm text-muted-foreground outline-none"
        />
        <SaveIndicator status={log.status} />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Delete log"
          title="Delete log"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MarkdownEditor
          value={log.content}
          onChange={(next) => onField({ content: next })}
          placeholder="What happened…"
          imagePrefix="work-logs"
          onTaskify={onTaskify}
        />
      </div>
    </>
  );
}
