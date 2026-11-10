"use client";

import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Highlighter,
  Loader2,
  Quote,
  Send,
  SquareDashedMousePointer,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@markbase/ui/button";
import { Input } from "@markbase/ui/input";
import { Textarea } from "@markbase/ui/textarea";
import { Markdown } from "@markbase/ui/markdown";
import { Dialog, DialogContent, DialogTitle } from "@markbase/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@markbase/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@markbase/ui/tabs";
import { cn } from "@markbase/ui/utils";
import { AppHeader, headerNoDrag } from "@markbase/ui/app-header";
import { useReader, type Annotation } from "./use-reader";
import { submitKeys } from "@markbase/ui/keys";

const LazyPdfPane = lazy(() => import("./pdf-pane"));

const ViewerLoading = () => (
  <div className="flex h-full items-center justify-center gap-2 bg-muted/30 text-sm text-muted-foreground">
    <Loader2 className="size-4 animate-spin" /> Loading viewer…
  </div>
);

/**
 * The viewer, loaded on demand and never during a server render.
 *
 * This was `next/dynamic` with `ssr: false`. That is a Next API, and a package
 * that imports one can only ever be rendered by a Next app — so the Electron
 * shell could never reuse it. `lazy` plus a mount gate is the framework-free
 * equivalent: the gate is what replaces `ssr: false`, because react-pdf reaches
 * for a DOM and spawns a web worker at module scope and must not be imported
 * where neither exists.
 */
function PdfPane(props: ComponentProps<typeof LazyPdfPane>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <ViewerLoading />;
  return (
    <Suspense fallback={<ViewerLoading />}>
      <LazyPdfPane {...props} />
    </Suspense>
  );
}

export function ReaderClient() {
  const r = useReader();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex h-svh flex-col">
      <AppHeader title="Reader">
        <div className={cn("flex min-w-0 flex-1 items-center gap-3", headerNoDrag)}>
        {r.documents.length > 0 && (
          <Select value={r.current?.id ?? ""} onValueChange={r.openDocument}>
            <SelectTrigger size="sm" className="w-[220px]">
              <SelectValue placeholder="Open a saved PDF…" />
            </SelectTrigger>
            <SelectContent>
              {r.documents.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          onChange={r.onPickFile}
          className="hidden"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={r.busy}
        >
          {r.busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          Upload PDF
        </Button>
        {r.current && (
          <>
            {/* Highlighter: select text to highlight it. */}
            <Button
              size="sm"
              variant={r.highlightMode ? "default" : "outline"}
              onClick={() => {
                r.setHighlightMode((v) => !v);
                r.setAreaMode(false);
              }}
              aria-pressed={r.highlightMode}
              title="Highlight selected text"
            >
              <Highlighter className="size-4" />
            </Button>
            {/* Area-selection tool: drag a box on the page to capture an image. */}
            <Button
              size="sm"
              variant={r.areaMode ? "default" : "outline"}
              onClick={() => {
                r.setAreaMode((v) => !v);
                r.setHighlightMode(false);
              }}
              aria-pressed={r.areaMode}
              title="Select an area as an image"
            >
              <SquareDashedMousePointer className="size-4" />
            </Button>
            {/* Jump to a page. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                r.jumpToPage(r.pageInput);
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground"
            >
              <Input
                value={r.pageInput}
                onChange={(e) => r.setPageInput(e.target.value)}
                onFocus={(e) => e.target.select()}
                inputMode="numeric"
                aria-label="Go to page"
                className="h-8 w-12 px-1 text-center"
              />
              <span className="whitespace-nowrap">/ {r.numPages || "…"}</span>
            </form>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={r.deleteDocument}
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          </>
        )}
        </div>
      </AppHeader>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {r.current ? (
            <PdfPane
              key={r.current.id}
              fileUrl={r.current.url}
              initialPage={r.current.last_page}
              jumpTo={r.jumpTo}
              areaMode={r.areaMode}
              highlightMode={r.highlightMode}
              highlights={r.highlights}
              onSelect={r.onSelect}
              onSelectArea={r.onSelectArea}
              onHighlight={r.onHighlight}
              onDeleteHighlight={r.deleteHighlight}
              onPageChange={r.onPageChange}
              onNumPages={r.setNumPages}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/30 text-center text-sm text-muted-foreground">
              <FileText className="size-8" />
              <p>Upload a PDF, then select text to ask questions about it.</p>
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" />
                Upload PDF
              </Button>
            </div>
          )}
        </div>

        <aside className="flex w-[400px] shrink-0 flex-col border-l">
          <Tabs
            defaultValue="questions"
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            <TabsList className="m-2 grid grid-cols-2">
              <TabsTrigger value="questions">
                Questions{r.annotations.length > 0 && ` (${r.annotations.length})`}
              </TabsTrigger>
              <TabsTrigger value="highlights">
                Highlights{r.highlights.length > 0 && ` (${r.highlights.length})`}
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="questions"
              className="mt-0 min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
            >
              {r.annotations.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                  {r.current
                    ? "Select text in the PDF to start a thread here."
                    : "No document open."}
                </p>
              ) : (
                r.annotations.map((a) => (
                  <AnnotationCard
                    key={a.id}
                    annotation={a}
                    onToggle={() => r.toggleExpand(a.id)}
                    onDraft={(v) => r.setDraft(a.id, v)}
                    onTitleChange={(v) => r.setTitle(a.id, v)}
                    onTitleSave={() => r.saveTitle(a)}
                    onQuoteChange={(v) => r.setQuote(a.id, v)}
                    onQuoteSave={() => r.saveQuote(a)}
                    onViewImage={() => a.image && r.setLightbox(a.image)}
                    onAsk={() => r.ask(a)}
                    onRemove={() => r.remove(a.id)}
                    onDeleteMessage={(mid) => r.deleteMessage(a.id, mid)}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent
              value="highlights"
              className="mt-0 min-h-0 flex-1 space-y-1 overflow-y-auto p-3"
            >
              {r.highlights.length === 0 ? (
                <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                  No highlights yet. Use the highlighter, then select text.
                </p>
              ) : (
                r.highlights.map((h) => (
                  <div
                    key={h.id}
                    className="group/hl flex items-start gap-2 rounded-md border p-2"
                  >
                    <button
                      type="button"
                      onClick={() => r.jumpToPage(String(h.page))}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left"
                      title="Go to page"
                    >
                      <span className="mt-0.5 size-3 shrink-0 rounded-sm bg-yellow-300/70" />
                      <span
                        className="min-w-0 flex-1 truncate text-xs"
                        title={h.text}
                      >
                        {h.text || "Highlight"}
                      </span>
                    </button>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      p.{h.page}
                    </span>
                    <button
                      type="button"
                      onClick={() => r.deleteHighlight(h.id)}
                      aria-label="Delete highlight"
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/hl:opacity-100 hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {/* Enlarged region image. */}
      <Dialog
        open={r.lightbox !== null}
        onOpenChange={(open) => !open && r.setLightbox(null)}
      >
        {/* Headerless dialog — opt into the container's fallback close button. */}
        <DialogContent showCloseButton className="max-w-[95vw] p-2 sm:max-w-[95vw]">
          <DialogTitle className="sr-only">Selected region</DialogTitle>
          {r.lightbox && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={r.lightbox}
              alt="Selected region"
              className="max-h-[88vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnnotationCard({
  annotation: a,
  onToggle,
  onDraft,
  onTitleChange,
  onTitleSave,
  onQuoteChange,
  onQuoteSave,
  onViewImage,
  onAsk,
  onRemove,
  onDeleteMessage,
}: {
  annotation: Annotation;
  onToggle: () => void;
  onDraft: (v: string) => void;
  onTitleChange: (v: string) => void;
  onTitleSave: () => void;
  onQuoteChange: (v: string) => void;
  onQuoteSave: () => void;
  onViewImage: () => void;
  onAsk: () => void;
  onRemove: () => void;
  onDeleteMessage: (messageId: string) => void;
}) {
  const headerTitle = a.title.trim() || a.text || "Image selection";
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {a.expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-xs font-medium" title={headerTitle}>
            {headerTitle}
          </span>
        </button>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          p.{a.page}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {a.expanded && (
        <div className="space-y-3 border-t px-3 py-3">
          {/* Editable toggle title — borderless. */}
          <input
            value={a.title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={onTitleSave}
            placeholder="Title…"
            aria-label="Toggle title"
            className="w-full bg-transparent text-xs font-medium outline-none placeholder:text-muted-foreground"
          />

          {/* Quoted content, with a divider line above it. */}
          <div className="border-t pt-3">
            {a.image ? (
              <button
                type="button"
                onClick={onViewImage}
                title="Click to enlarge"
                className="block w-full"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.image}
                  alt="Selected region"
                  className="max-h-56 w-full cursor-zoom-in rounded-md border object-contain"
                />
              </button>
            ) : (
              <div className="flex gap-2 rounded-md bg-muted/50 p-2">
                <Quote className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                <Textarea
                  value={a.text}
                  onChange={(e) => onQuoteChange(e.target.value)}
                  onBlur={onQuoteSave}
                  rows={3}
                  aria-label="Quoted text (editable)"
                  className="min-h-0 resize-y border-0 bg-transparent p-0 text-xs text-muted-foreground shadow-none focus-visible:ring-0"
                />
              </div>
            )}
          </div>

          {a.qa.map((qa) => (
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
            {a.asking ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <input
              value={a.draft}
              onChange={(e) => onDraft(e.target.value)}
              disabled={a.asking}
              placeholder="Ask about this passage…"
              aria-label="Ask about this passage"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              onKeyDown={submitKeys({ onSubmit: onAsk })}
            />
            <button
              type="submit"
              disabled={a.asking || !a.draft.trim()}
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
