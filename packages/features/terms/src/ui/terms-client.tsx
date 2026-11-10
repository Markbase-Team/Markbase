"use client";

import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Send,
  X,
} from "lucide-react";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Markdown } from "@markbase/ui/markdown";
import { AppHeader } from "@markbase/ui/app-header";
import { useTerms, type TermView } from "./use-terms";
import { submitKeys } from "@markbase/ui/keys";

export function TermsClient() {
  const t = useTerms();

  return (
    <div className="flex h-svh w-full min-w-0 flex-col">
      <AppHeader title="Terms" />
      <div className="min-h-0 flex-1 overflow-y-auto">
      <main className="max-w-3xl px-4 py-6 sm:px-6">
      <p className="text-sm text-muted-foreground sm:text-base">
        Enter a term to get its definition, then chat to understand it better.
      </p>

      {/* New term. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          t.addTerm();
        }}
        className="mt-6 flex gap-2"
      >
        <Input
          value={t.input}
          onChange={(e) => t.setInput(e.target.value)}
          placeholder="Enter a term…"
          aria-label="New term"
        />
        <Button type="submit" disabled={t.adding || !t.input.trim()}>
          {t.adding ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Define
        </Button>
      </form>

      <div className="mt-6 space-y-2">
        {t.terms.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No terms yet. Enter one above to get started.
          </p>
        ) : (
          t.terms.map((term) => (
            <TermCard
              key={term.id}
              term={term}
              onToggle={() => t.toggleExpand(term.id)}
              onDraft={(v) => t.setDraft(term.id, v)}
              onAsk={() => t.ask(term)}
              onRemove={() => t.remove(term.id)}
              onDeleteMessage={(mid) => t.deleteMessage(term.id, mid)}
            />
          ))
        )}
      </div>
      </main>
      </div>
    </div>
  );
}

function TermCard({
  term: t,
  onToggle,
  onDraft,
  onAsk,
  onRemove,
  onDeleteMessage,
}: {
  term: TermView;
  onToggle: () => void;
  onDraft: (v: string) => void;
  onAsk: () => void;
  onRemove: () => void;
  onDeleteMessage: (messageId: string) => void;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {t.expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium" title={t.term}>
            {t.term}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {t.expanded && (
        <div className="space-y-3 border-t px-3 py-3">
          {/* Definition. */}
          <div className="rounded-md bg-muted/40 p-2 text-sm">
            {t.definition ? (
              <Markdown content={t.definition} />
            ) : (
              <span className="text-muted-foreground">
                No definition yet — ask below.
              </span>
            )}
          </div>

          {/* Follow-up Q&A. */}
          {t.qa.map((qa) => (
            <div key={qa.id} className="group/qa space-y-1.5">
              <div className="flex items-start gap-1.5">
                <p className="flex-1 text-xs font-medium">{qa.q}</p>
                <button
                  type="button"
                  onClick={() => onDeleteMessage(qa.id)}
                  aria-label="Delete answer"
                  className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/qa:opacity-100 hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </div>
              <div className="rounded-md bg-muted/40 p-2 text-sm">
                <Markdown content={qa.a} />
              </div>
            </div>
          ))}

          {/* Prompt-style ask row: a divider line, then chevron + input. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAsk();
            }}
            className="flex items-center gap-1.5 border-t pt-3"
          >
            {t.asking ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <input
              value={t.draft}
              onChange={(e) => onDraft(e.target.value)}
              disabled={t.asking}
              placeholder="Ask to understand more…"
              aria-label="Ask about this term"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              onKeyDown={submitKeys({ onSubmit: onAsk })}
            />
            <button
              type="submit"
              disabled={t.asking || !t.draft.trim()}
              aria-label="Send"
              title="Send"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
