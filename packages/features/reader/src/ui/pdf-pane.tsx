"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Loader2 } from "lucide-react";
import { cn } from "@markbase/ui/utils";

type Rect = { x: number; y: number; w: number; h: number };
type Highlight = {
  id: string;
  page: number;
  rects: Rect[];
  color: string;
  text: string;
};

// Resolve the pdf.js worker out of the installed package so the bundler emits it
// as an asset of this build.
//
// This used to point at unpkg.com, which meant the reader did not work offline —
// the desktop app has to open a PDF on a plane. It also silently coupled the
// viewer to a third party's uptime and to whatever that CDN served for the
// version string. Resolving locally fixes both, and guarantees the worker is the
// exact build `pdfjs-dist` shipped rather than a same-version rebuild.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Left pane: renders every page with a selectable text layer. Reports text
// selections (with their page), which pages are visible (so the right pane can
// fold toggles whose page scrolled away), and the current page (so it can be
// saved). Jumps to `initialPage` on open. Loaded client-only.
export default function PdfPane({
  fileUrl,
  initialPage = 1,
  jumpTo,
  areaMode = false,
  highlightMode = false,
  highlights = [],
  onSelect,
  onSelectArea,
  onHighlight,
  onDeleteHighlight,
  onPageChange,
  onNumPages,
}: {
  fileUrl: string;
  initialPage?: number;
  // Bump the nonce to scroll to `page` on demand (header "go to page").
  jumpTo?: { page: number; nonce: number } | null;
  // When true, drag a rectangle to capture a page region as an image.
  areaMode?: boolean;
  // When true, selecting text highlights it instead of opening a Q&A toggle.
  highlightMode?: boolean;
  highlights?: Highlight[];
  onSelect: (page: number, text: string) => void;
  onSelectArea?: (page: number, dataUrl: string) => void;
  onHighlight?: (page: number, rects: Rect[], text: string) => void;
  onDeleteHighlight?: (id: string) => void;
  onPageChange: (page: number) => void;
  onNumPages?: (n: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);

  // Size pages to the container width (minus padding) and keep them responsive.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, el.clientWidth - 32));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Don't report (and persist) the current page until we've jumped to the saved
  // page, so the initial render doesn't clobber it with page 1.
  const jumpedRef = useRef(false);
  const lastPageRef = useRef(0);

  // Track visible pages; report the visible set + the topmost visible page.
  const visibleRef = useRef<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const e of entries) {
          const page = Number((e.target as HTMLElement).dataset.pageWrap);
          if (!page) continue;
          if (e.isIntersecting) {
            if (!visibleRef.current.has(page)) {
              visibleRef.current.add(page);
              changed = true;
            }
          } else if (visibleRef.current.delete(page)) {
            changed = true;
          }
        }
        if (!changed) return;
        const current = visibleRef.current.size
          ? Math.min(...visibleRef.current)
          : 0;
        if (jumpedRef.current && current && current !== lastPageRef.current) {
          lastPageRef.current = current;
          onPageChange(current);
        }
      },
      { root, threshold: 0.05 }
    );
    observerRef.current = obs;
    return () => {
      obs.disconnect();
      observerRef.current = null;
    };
  }, [onPageChange]);

  const observePage = useCallback((el: HTMLDivElement | null) => {
    if (el && observerRef.current) observerRef.current.observe(el);
  }, []);

  // Scroll a page to the top of the container.
  const scrollToPage = useCallback((page: number) => {
    const root = containerRef.current;
    const wrap = root?.querySelector(
      `[data-page-wrap="${page}"]`
    ) as HTMLElement | null;
    if (root && wrap) {
      root.scrollTop +=
        wrap.getBoundingClientRect().top - root.getBoundingClientRect().top - 8;
    }
  }, []);

  // Once the saved page has rendered, jump to it (one time, on open).
  const handleRendered = useCallback(
    (page: number) => {
      if (jumpedRef.current) return;
      if (page !== Math.max(1, initialPage)) return;
      scrollToPage(page);
      jumpedRef.current = true;
      lastPageRef.current = page;
    },
    [initialPage, scrollToPage]
  );

  // On-demand jump from the header control.
  useEffect(() => {
    if (jumpTo) scrollToPage(jumpTo.page);
  }, [jumpTo, scrollToPage]);

  // Area selection: drag a rectangle, then crop the underlying page canvas.
  const [drag, setDrag] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);

  function startArea(e: React.MouseEvent) {
    if (!areaMode || e.button !== 0) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    setDrag({ x0: start.x, y0: start.y, x1: start.x, y1: start.y });
    const move = (ev: MouseEvent) =>
      setDrag((d) => (d ? { ...d, x1: ev.clientX, y1: ev.clientY } : d));
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDrag(null);
      finishArea(start, { x: ev.clientX, y: ev.clientY });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  // Crop the page canvas under the dragged rectangle to a PNG data URL.
  function finishArea(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ) {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x);
    const bottom = Math.max(start.y, end.y);
    if (right - left < 8 || bottom - top < 8) return;

    const target = document.elementFromPoint(start.x, start.y);
    const wrap = (target as Element | null)?.closest(
      "[data-page-wrap]"
    ) as HTMLElement | null;
    const canvas = wrap?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!wrap || !canvas) return;
    const page = Number(wrap.dataset.pageWrap) || 1;

    const cr = canvas.getBoundingClientRect();
    const sx = Math.max(0, left - cr.left);
    const sy = Math.max(0, top - cr.top);
    const ex = Math.min(cr.width, right - cr.left);
    const ey = Math.min(cr.height, bottom - cr.top);
    const sw = ex - sx;
    const sh = ey - sy;
    if (sw < 4 || sh < 4) return;

    const scaleX = canvas.width / cr.width;
    const scaleY = canvas.height / cr.height;
    const out = document.createElement("canvas");
    out.width = Math.round(sw * scaleX);
    out.height = Math.round(sh * scaleY);
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(
      canvas,
      sx * scaleX,
      sy * scaleY,
      sw * scaleX,
      sh * scaleY,
      0,
      0,
      out.width,
      out.height
    );
    onSelectArea?.(page, out.toDataURL("image/png"));
  }

  function handleMouseUp() {
    if (areaMode) return; // area mode handles its own drag
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const anchor = sel.anchorNode;
    const el =
      anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
    const wrap = el?.closest("[data-page-wrap]") as HTMLElement | null;
    const page = wrap ? Number(wrap.dataset.pageWrap) : 1;

    // Highlight mode: capture the selection's line boxes as page-normalized
    // rects and clear the selection.
    if (highlightMode) {
      if (!wrap) return;
      const wr = wrap.getBoundingClientRect();
      const rects = Array.from(sel.getRangeAt(0).getClientRects())
        .map((r) => ({
          x: (r.left - wr.left) / wr.width,
          y: (r.top - wr.top) / wr.height,
          w: r.width / wr.width,
          h: r.height / wr.height,
        }))
        .filter((rc) => rc.w > 0.002 && rc.h > 0.002);
      const text = sel.toString().replace(/\s+/g, " ").trim();
      sel.removeAllRanges();
      if (rects.length) onHighlight?.(page || 1, rects, text);
      return;
    }

    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (text.length < 2) return;
    onSelect(page || 1, text);
  }

  // Highlights grouped by page for rendering.
  const highlightsByPage = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    for (const h of highlights) {
      const arr = map.get(h.page) ?? [];
      arr.push(h);
      map.set(h.page, arr);
    }
    return map;
  }, [highlights]);

  return (
    <div
      ref={containerRef}
      onMouseUp={handleMouseUp}
      onMouseDown={startArea}
      className={
        "h-full overflow-auto bg-muted/30 px-4 py-4" +
        (areaMode
          ? " cursor-crosshair select-none [&_.react-pdf__Page__textContent]:pointer-events-none"
          : "")
      }
    >
      {/* Live area-selection rectangle (viewport coords). */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 border-2 border-primary bg-primary/10"
          style={{
            left: Math.min(drag.x0, drag.x1),
            top: Math.min(drag.y0, drag.y1),
            width: Math.abs(drag.x1 - drag.x0),
            height: Math.abs(drag.y1 - drag.y0),
          }}
        />
      )}
      <Document
        file={fileUrl}
        onLoadSuccess={(pdf: { numPages: number }) => {
          setNumPages(pdf.numPages);
          onNumPages?.(pdf.numPages);
        }}
        loading={
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading PDF…
          </div>
        }
        error={
          <div className="py-20 text-center text-sm text-destructive">
            Couldn&apos;t load this PDF.
          </div>
        }
        className="mx-auto flex w-fit flex-col items-center gap-4"
      >
        {Array.from({ length: numPages }, (_, i) => (
          <div
            key={i}
            data-page-wrap={i + 1}
            ref={observePage}
            className="relative overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/5"
          >
            <Page
              pageNumber={i + 1}
              width={width || undefined}
              renderAnnotationLayer={false}
              renderTextLayer
              onRenderSuccess={() => handleRendered(i + 1)}
            />
            {/* Highlight overlays (page-normalized). Clickable to remove only
                in highlight mode, so they never block text selection otherwise. */}
            {(highlightsByPage.get(i + 1) ?? []).flatMap((h) =>
              h.rects.map((rc, ri) => (
                <div
                  key={`${h.id}-${ri}`}
                  onClick={
                    highlightMode ? () => onDeleteHighlight?.(h.id) : undefined
                  }
                  title={highlightMode ? "Click to remove highlight" : undefined}
                  className={cn(
                    "absolute bg-yellow-300/40 mix-blend-multiply",
                    highlightMode
                      ? "cursor-pointer hover:bg-yellow-400/60"
                      : "pointer-events-none"
                  )}
                  style={{
                    left: `${rc.x * 100}%`,
                    top: `${rc.y * 100}%`,
                    width: `${rc.w * 100}%`,
                    height: `${rc.h * 100}%`,
                  }}
                />
              ))
            )}
          </div>
        ))}
      </Document>
    </div>
  );
}
