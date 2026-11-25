"use client";

import { toast } from "sonner";
import { Loader2, Square } from "lucide-react";
import { AppHeader } from "@markbase/ui/app-header";
import { useNavigation } from "@markbase/ui/navigation";
import type { ViewResult, ViewRow } from "@markbase/shared/docs/view-types";
import { useToday } from "./use-today";

// Today: the built-in view `today`, rendered. A task is just a document of
// `type: task`, and Today is just a view of them (open, yours, due within a
// week or undated, grouped by day), so this page shows whatever that view
// answers. Each task links to its document; ticking one sets its `done`
// property, in your name.

/** "Thu, Nov 27" for a YYYY-MM-DD day, read as that calendar day. */
function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** What a group of the view is called on the page. */
export function groupLabel(key: string): string {
  if (key === "overdue") return "Overdue";
  if (key === "today") return "Today";
  if (key === "none") return "No due date";
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? dayLabel(key) : key;
}

export function Today() {
  const { view, error, loading, finish } = useToday();
  const onFinish = async (row: ViewRow) => {
    const failed = await finish(row.id);
    if (failed) toast.error(`Couldn't mark “${row.title}” done: ${failed}`);
  };
  return (
    <div className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader title="Today!" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-6 sm:px-6">
          <div className="max-w-3xl">
            <TodayBody view={view} error={error} loading={loading} onFinish={onFinish} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The list, from a view's answer: apart from the fetching, so it can be shown and tested on its own. */
export function TodayBody({
  view,
  error,
  loading,
  onFinish,
}: {
  view: ViewResult | null;
  error: string | null;
  loading: boolean;
  onFinish: (row: ViewRow) => void;
}) {
  if (!view) {
    if (error) return <p className="text-sm text-destructive">Couldn't load your tasks: {error}</p>;
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {loading && <Loader2 className="size-4 animate-spin" />} Loading your tasks…
      </p>
    );
  }
  const open = view.rows.length;
  const groups = view.groups ?? [{ key: "today", rows: view.rows }];
  return (
    <>
      <p className="text-sm text-muted-foreground sm:text-base">
        {dayLabel(view.today)} · {open === 0 ? "nothing open" : `${open} open`}
      </p>
      {open === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Nothing needs you. A task is any document with <code>type: task</code> in its front matter, and{" "}
          <code>assignee</code>, <code>due</code> and <code>done</code> if you want them.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {groups.map((g) => (
            <Group key={g.key} title={groupLabel(g.key)} overdue={g.key === "overdue"} rows={g.rows} onFinish={onFinish} />
          ))}
        </div>
      )}
    </>
  );
}

function Group({
  title,
  overdue,
  rows,
  onFinish,
}: {
  title: string;
  overdue: boolean;
  rows: ViewRow[];
  onFinish: (row: ViewRow) => void;
}) {
  const { routes, Link } = useNavigation();
  return (
    <section>
      <h2 className={`mb-2 text-sm font-semibold ${overdue ? "text-red-600 dark:text-red-400" : ""}`}>
        {title} <span className="font-normal text-muted-foreground">{rows.length}</span>
      </h2>
      <ul className="divide-y rounded-md border">
        {rows.map((row) => {
          const due = typeof row.fields.due === "string" ? row.fields.due : null;
          return (
            <li key={row.id} className="flex items-center gap-3 px-3 py-2">
              <button
                type="button"
                onClick={() => onFinish(row)}
                aria-label={`Mark “${row.title}” done`}
                className="text-muted-foreground hover:text-foreground"
              >
                <Square className="size-4" />
              </button>
              <Link href={routes.document(row.id)} className="min-w-0 flex-1 truncate hover:underline">
                {row.title}
              </Link>
              {row.fields.assignee == null && (
                <span className="shrink-0 text-xs text-muted-foreground" title="No assignee: you own the document">
                  yours by default
                </span>
              )}
              {due && due.length > 10 && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(due).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
