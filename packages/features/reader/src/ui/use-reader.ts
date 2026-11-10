"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadImages, uploadPdf } from "@markbase/protocol/upload";

export type QA = { id: string; q: string; a: string };

export type Annotation = {
  id: string; // reader_selections.id
  page: number;
  title: string; // editable; empty falls back to text/"Image selection"
  text: string;
  image: string | null; // area selection: cropped region URL
  draft: string;
  expanded: boolean;
  asking: boolean;
  qa: QA[];
};

export type Doc = { id: string; name: string; url: string; last_page: number };

export type Rect = { x: number; y: number; w: number; h: number };
export type Highlight = {
  id: string;
  page: number;
  rects: Rect[];
  color: string;
  text: string;
};

// Shapes returned by the reader API.
type SelectionRow = {
  id: string;
  page: number;
  title: string;
  text: string;
  image_url: string | null;
  messages: { id: string; question: string; answer: string }[];
};

// All Reader state + actions. The component is a thin view over this hook.
export function useReader() {
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [current, setCurrent] = useState<Doc | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [busy, setBusy] = useState(false); // uploading / loading a document
  // Page navigation: current/total + a jump signal (nonce re-triggers same page).
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const [jumpTo, setJumpTo] = useState<{ page: number; nonce: number } | null>(
    null
  );
  const [areaMode, setAreaMode] = useState(false); // drag-to-capture-region
  const [highlightMode, setHighlightMode] = useState(false); // select-to-highlight
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null); // enlarged image
  const nonceRef = useRef(0);

  // Keep the page input in sync as the reader scrolls — adjusted during render,
  // so the box never shows the page you just left.
  const [inputFor, setInputFor] = useState(currentPage);
  if (inputFor !== currentPage) {
    setInputFor(currentPage);
    setPageInput(String(currentPage));
  }

  function jumpToPage(raw: string) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1) return;
    const page = numPages ? Math.min(n, numPages) : n;
    nonceRef.current += 1;
    setJumpTo({ page, nonce: nonceRef.current });
  }

  // Refs so the stable selection handlers can read the latest state.
  const currentRef = useRef<Doc | null>(null);
  const annotationsRef = useRef<Annotation[]>([]);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  // Load the saved document list on mount.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/reader/documents");
        const data: { documents?: Doc[] } = await res.json();
        if (res.ok) setDocuments(data.documents ?? []);
      } catch {
        // ignore — empty list
      }
    })();
  }, []);

  async function openDocument(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/reader/documents/${id}`);
      const data: {
        document?: Doc;
        selections?: SelectionRow[];
        highlights?: Highlight[];
        error?: string;
      } = await res.json();
      if (!res.ok || !data.document) throw new Error(data.error ?? "Failed");
      setCurrent({
        id: data.document.id,
        name: data.document.name,
        url: data.document.url,
        last_page: data.document.last_page ?? 1,
      });
      setCurrentPage(data.document.last_page ?? 1);
      setNumPages(0);
      setJumpTo(null);
      setHighlights(data.highlights ?? []);
      setAnnotations(
        (data.selections ?? []).map((s) => ({
          id: s.id,
          page: s.page,
          title: s.title ?? "",
          text: s.text,
          image: s.image_url ?? null,
          draft: "",
          expanded: false,
          asking: false,
          qa: s.messages.map((m) => ({
            id: m.id,
            q: m.question,
            a: m.answer,
          })),
        }))
      );
    } catch {
      toast.error("Couldn't open that document");
    } finally {
      setBusy(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.type !== "application/pdf") {
      toast.error("Please choose a PDF file");
      return;
    }
    setBusy(true);
    try {
      const { path, url } = await uploadPdf(f);
      const res = await fetch("/api/v1/reader/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: f.name, path, url }),
      });
      const data: { document?: Doc; error?: string } = await res.json();
      if (!res.ok || !data.document) throw new Error(data.error ?? "Failed");
      setDocuments((prev) => [data.document!, ...prev]);
      setCurrent({
        id: data.document.id,
        name: data.document.name,
        url: data.document.url,
        last_page: data.document.last_page ?? 1,
      });
      setCurrentPage(1);
      setNumPages(0);
      setJumpTo(null);
      setHighlights([]);
      setAnnotations([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDocument() {
    const doc = current;
    if (!doc) return;
    if (!confirm(`Delete "${doc.name}" and its notes?`)) return;
    try {
      const res = await fetch(`/api/v1/reader/documents/${doc.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setCurrent(null);
      setAnnotations([]);
      setHighlights([]);
    } catch {
      toast.error("Couldn't delete the document");
    }
  }

  // Save a highlight (page-normalized rects), optimistically.
  const onHighlight = useCallback(
    async (page: number, rects: Rect[], text: string) => {
    const doc = currentRef.current;
    if (!doc || rects.length === 0) return;
    try {
      const res = await fetch("/api/v1/reader/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_id: doc.id, page, rects, text }),
      });
      const data: { highlight?: Highlight } = await res.json();
      if (!res.ok || !data.highlight) throw new Error();
      setHighlights((prev) => [...prev, data.highlight!]);
    } catch {
      toast.error("Couldn't save highlight");
    }
  }, []);

  const deleteHighlight = useCallback(async (id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
    try {
      await fetch(`/api/v1/reader/highlights/${id}`, { method: "DELETE" });
    } catch {
      // best-effort
    }
  }, []);

  // New text selection → persist it, add a toggle (expanded), fold the others.
  const onSelect = useCallback(async (page: number, text: string) => {
    const doc = currentRef.current;
    if (!doc) return;
    const prev = annotationsRef.current;
    const last = prev[prev.length - 1];
    if (last && last.page === page && last.text === text) return; // dup
    try {
      const res = await fetch("/api/v1/reader/selections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          document_id: doc.id,
          page,
          text,
          position: prev.length,
        }),
      });
      const data: { selection?: { id: string; page: number; text: string } } =
        await res.json();
      if (!res.ok || !data.selection) throw new Error();
      const sel = data.selection;
      setAnnotations((cur) => [
        ...cur.map((a) => ({ ...a, expanded: false })),
        {
          id: sel.id,
          page: sel.page,
          title: "",
          text: sel.text,
          image: null,
          draft: "",
          expanded: true,
          asking: false,
          qa: [],
        },
      ]);
    } catch {
      toast.error("Couldn't save selection");
    }
  }, []);

  // Area selection → upload the cropped region, save it, add an image toggle.
  const onSelectArea = useCallback(async (page: number, dataUrl: string) => {
    const doc = currentRef.current;
    if (!doc) return;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `region-p${page}.png`, {
        type: "image/png",
      });
      const [url] = await uploadImages([file], "regions", "reader-pdfs");
      const prev = annotationsRef.current;
      const res = await fetch("/api/v1/reader/selections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          document_id: doc.id,
          page,
          image_url: url,
          position: prev.length,
        }),
      });
      const data: { selection?: { id: string; page: number } } =
        await res.json();
      if (!res.ok || !data.selection) throw new Error();
      const sel = data.selection;
      setAnnotations((cur) => [
        ...cur.map((a) => ({ ...a, expanded: false })),
        {
          id: sel.id,
          page: sel.page,
          title: "",
          text: "",
          image: url,
          draft: "",
          expanded: true,
          asking: false,
          qa: [],
        },
      ]);
    } catch {
      toast.error("Couldn't save the region");
    }
  }, []);

  // Persist the last-read page (debounced) as the reader scrolls.
  const pageSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPageChange = useCallback((page: number) => {
    setCurrentPage(page);
    const doc = currentRef.current;
    if (!doc) return;
    if (pageSaveRef.current) clearTimeout(pageSaveRef.current);
    pageSaveRef.current = setTimeout(() => {
      fetch(`/api/v1/reader/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ last_page: page }),
      }).catch(() => {});
    }, 800);
  }, []);

  function toggleExpand(id: string) {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, expanded: !a.expanded } : a))
    );
  }

  function setDraft(id: string, draft: string) {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, draft } : a))
    );
  }

  // Live-edit the toggle title; persist on blur.
  function setTitle(id: string, title: string) {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, title } : a))
    );
  }

  async function saveTitle(ann: Annotation) {
    try {
      const res = await fetch(`/api/v1/reader/selections/${ann.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: ann.title.trim() }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save the title");
    }
  }

  // Live-edit the quoted passage; persist on blur.
  function setQuote(id: string, text: string) {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, text } : a))
    );
  }

  async function saveQuote(ann: Annotation) {
    const text = ann.text.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/v1/reader/selections/${ann.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save the edit");
    }
  }

  async function remove(id: string) {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch(`/api/v1/reader/selections/${id}`, { method: "DELETE" });
    } catch {
      // best-effort; the row is gone from the UI either way
    }
  }

  // Delete a single Q&A message from a selection's thread.
  async function deleteMessage(annId: string, messageId: string) {
    setAnnotations((prev) =>
      prev.map((a) =>
        a.id === annId
          ? { ...a, qa: a.qa.filter((q) => q.id !== messageId) }
          : a
      )
    );
    try {
      await fetch(`/api/v1/reader/messages/${messageId}`, {
        method: "DELETE",
      });
    } catch {
      // best-effort
    }
  }

  async function ask(ann: Annotation) {
    const question = ann.draft.trim();
    if (!question || ann.asking) return;
    setAnnotations((prev) =>
      prev.map((a) => (a.id === ann.id ? { ...a, asking: true } : a))
    );
    try {
      const res = await fetch("/api/v1/reader/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selection_id: ann.id,
          quote: ann.text,
          image_url: ann.image ?? undefined,
          question,
        }),
      });
      const data: { answer?: string; messageId?: string; error?: string } =
        await res.json();
      if (!res.ok || !data.answer) throw new Error(data.error ?? "Failed");
      setAnnotations((prev) =>
        prev.map((a) =>
          a.id === ann.id
            ? {
                ...a,
                asking: false,
                draft: "",
                qa: [
                  ...a.qa,
                  {
                    id: data.messageId ?? crypto.randomUUID(),
                    q: question,
                    a: data.answer!,
                  },
                ],
              }
            : a
        )
      );
    } catch (err) {
      setAnnotations((prev) =>
        prev.map((a) => (a.id === ann.id ? { ...a, asking: false } : a))
      );
      toast.error(err instanceof Error ? err.message : "Couldn't ask");
    }
  }

  return {
    // state
    documents,
    current,
    annotations,
    busy,
    numPages,
    pageInput,
    jumpTo,
    areaMode,
    highlightMode,
    highlights,
    lightbox,
    // setters used by the view
    setPageInput,
    setNumPages,
    setAreaMode,
    setHighlightMode,
    setLightbox,
    // actions
    jumpToPage,
    openDocument,
    onPickFile,
    deleteDocument,
    onSelect,
    onSelectArea,
    onHighlight,
    deleteHighlight,
    onPageChange,
    toggleExpand,
    setDraft,
    setTitle,
    saveTitle,
    setQuote,
    saveQuote,
    remove,
    ask,
    deleteMessage,
  };
}
