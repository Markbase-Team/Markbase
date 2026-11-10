"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type SaveStatus = "idle" | "saving" | "saved";

export type DiaryView = {
  id: string;
  entry_date: string; // YYYY-MM-DD
  title: string;
  content: string;
  status: SaveStatus;
};

type DiaryRow = {
  id: string;
  entry_date: string;
  title: string;
  content: string;
};

// How long after the last keystroke we flush an autosave.
const AUTOSAVE_MS = 700;

// The browser's local date as YYYY-MM-DD (so a new entry defaults to today).
function todayLocal(): string {
  const d = new Date();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Sort by date, newest first. Stable for equal dates (V8), so editing an
// entry's body never reshuffles the list — only a date change re-orders it.
function sortByDate(list: DiaryView[]): DiaryView[] {
  return [...list].sort((a, b) =>
    a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : 0
  );
}

const toView = (d: DiaryRow): DiaryView => ({
  id: d.id,
  entry_date: d.entry_date,
  title: d.title,
  content: d.content,
  status: "idle",
});

// All Learning Diary state + actions. Edits autosave (debounced); the view is a
// thin layer over this hook.
export function useDiary() {
  const [diaries, setDiaries] = useState<DiaryView[]>([]);
  const [adding, setAdding] = useState(false);

  // Pending autosave timers and the latest field values per entry. Reading the
  // draft from a ref (not state) means a flush always sends what's on screen
  // right now and never clobbers newer keystrokes with a stale server echo.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const drafts = useRef<
    Record<string, { entry_date: string; title: string; content: string }>
  >({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/diaries");
        const data: { diaries?: DiaryRow[] } = await res.json();
        if (!res.ok) return;
        for (const d of data.diaries ?? []) {
          drafts.current[d.id] = {
            entry_date: d.entry_date,
            title: d.title,
            content: d.content,
          };
        }
        setDiaries((data.diaries ?? []).map(toView));
      } catch {
        // ignore — empty list
      }
    })();
    // Clear any pending timers on unmount. The ref is read HERE, while the
    // effect is set up, not in the cleanup: by cleanup time `timers.current`
    // could be a different object than the one this effect meant.
    const pending = timers.current;
    return () => {
      for (const t of Object.values(pending)) clearTimeout(t);
    };
  }, []);

  // Push the current draft for an entry to the server. Only flips the status
  // flag on success — it never overwrites on-screen fields (the user may have
  // kept typing), which keeps the markdown editor's cursor stable.
  async function flush(id: string) {
    const draft = drafts.current[id];
    if (!draft) return;
    setDiaries((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: "saving" } : d))
    );
    try {
      const res = await fetch(`/api/admin/diaries/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data: { diary?: DiaryRow; error?: string } = await res.json();
      if (!res.ok || !data.diary) throw new Error(data.error ?? "Failed");
      setDiaries((prev) =>
        sortByDate(
          prev.map((d) => (d.id === id ? { ...d, status: "saved" } : d))
        )
      );
    } catch (err) {
      setDiaries((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: "idle" } : d))
      );
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    }
  }

  // Edit a field locally and schedule a debounced autosave.
  function setField(
    id: string,
    patch: Partial<Pick<DiaryView, "entry_date" | "title" | "content">>
  ) {
    drafts.current[id] = { ...drafts.current[id], ...patch };
    setDiaries((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch, status: "saving" } : d))
    );
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => flush(id), AUTOSAVE_MS);
  }

  // Start a fresh entry dated today, shown at the top, ready to write in.
  async function addEntry(): Promise<string | undefined> {
    if (adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/diaries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entry_date: todayLocal() }),
      });
      const data: { diary?: DiaryRow; error?: string } = await res.json();
      if (!res.ok || !data.diary) throw new Error(data.error ?? "Failed");
      drafts.current[data.diary.id] = {
        entry_date: data.diary.entry_date,
        title: data.diary.title,
        content: data.diary.content,
      };
      setDiaries((prev) => sortByDate([toView(data.diary!), ...prev]));
      return data.diary.id;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add entry");
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    delete drafts.current[id];
    setDiaries((prev) => prev.filter((d) => d.id !== id));
    try {
      await fetch(`/api/admin/diaries/${id}`, { method: "DELETE" });
    } catch {
      // best-effort
    }
  }

  return { diaries, adding, addEntry, setField, remove };
}
