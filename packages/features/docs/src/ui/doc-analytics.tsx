"use client";

import { Bot, UserRound } from "lucide-react";
import { agentLabel, writerText, type AgentReadTally, type LineWriter } from "@markbase/docs";
import { cn } from "@markbase/ui/utils";
import { useDocAnalytics } from "./use-doc-analytics";

// The Analytics panel: which agents read this document and for whom, and who
// wrote what is in it now — a person, or an agent, and whose agent. Both come
// from the document's own CRDT (see use-doc-analytics). What agents do is
// known only where their hooks report it (`markbase audit install`), which
// the empty states say.
//
// Sections are set apart by their headings and space; there are no rules.

/** The mark beside a writer: lime for an agent, grey for a person, both for a mix. */
function WriterMark({ writer }: { writer: LineWriter }) {
  if (writer.kind === "unrecorded") {
    return <span className="size-4 shrink-0 rounded-full border border-dashed border-muted-foreground/60" />;
  }
  const agent = writer.kind === "agent" || writer.kind === "mixed";
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full",
        agent ? "bg-[#e5ff6e] text-zinc-900" : "bg-muted text-muted-foreground"
      )}
    >
      {agent ? <Bot className="size-3" /> : <UserRound className="size-3" />}
    </span>
  );
}

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ReadRow({ read }: { read: AgentReadTally }) {
  return (
    <li className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2">
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#e5ff6e] text-zinc-900">
        <Bot className="size-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {agentLabel(read.agent)}
          {read.owner && <span className="font-normal text-muted-foreground"> · {read.owner}’s</span>}
        </span>
        <span className="block truncate text-muted-foreground">last {when(read.lastAt)}</span>
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums">{read.count}</span>
    </li>
  );
}

export function DocAnalytics({ docId }: { docId: string }) {
  const { reads, credit, loading } = useDocAnalytics(docId, true);
  if (loading) return <p className="text-xs text-muted-foreground">Loading analytics…</p>;

  const totalReads = reads.reduce((sum, r) => sum + r.count, 0);
  return (
    <div className="space-y-7 text-xs" data-testid="doc-analytics">
      <section className="space-y-2">
        <h3 className="flex items-baseline justify-between text-sm font-semibold">
          Read by agents
          {totalReads > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {totalReads} {totalReads === 1 ? "read" : "reads"}
            </span>
          )}
        </h3>
        {reads.length === 0 ? (
          <p className="text-muted-foreground">
            No agent has read this file yet, as far as their hooks report. Set the hooks up with{" "}
            <code className="rounded bg-muted px-1 py-0.5">markbase audit install</code>.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {reads.map((read) => (
              <ReadRow key={`${read.owner ?? ""}/${read.agent}`} read={read} />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Who wrote it</h3>
        {!credit || credit.lines === 0 ? (
          <p className="text-muted-foreground">Nothing written yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {credit.shares.map((share) => {
              const percent = Math.round((share.lines / credit.lines) * 100);
              return (
                <li key={writerText(share.writer)} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <WriterMark writer={share.writer} />
                    <span className="min-w-0 flex-1 truncate font-medium">{writerText(share.writer)}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {percent}% · {share.lines} {share.lines === 1 ? "line" : "lines"}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        share.writer.kind === "agent" || share.writer.kind === "mixed"
                          ? "bg-[#c7e600]"
                          : "bg-foreground"
                      )}
                      style={{ width: `${Math.max(percent, 2)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {credit && credit.ranges.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Line by line</h3>
          <ol className="space-y-1.5">
            {credit.ranges.map((range) => (
              <li key={range.from} className="flex gap-2 rounded-lg bg-muted/60 px-2.5 py-2">
                <WriterMark writer={range.writer} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{writerText(range.writer)}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {range.from === range.to ? `line ${range.from}` : `lines ${range.from}–${range.to}`}
                    </span>
                  </span>
                  <span className="block truncate text-muted-foreground">{range.preview}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
