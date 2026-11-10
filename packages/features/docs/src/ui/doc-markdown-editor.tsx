"use client";

import { Suspense, lazy, useEffect, useState, type ComponentProps } from "react";

const LazyEditor = lazy(() => import("./doc-markdown-editor-cm"));

const EditorSkeleton = () => (
  <div className="h-40 w-full animate-pulse rounded-lg bg-muted/40" />
);

/**
 * The document's CodeMirror editor, loaded on demand and never on the server.
 *
 * CodeMirror touches the DOM as it builds, so the chunk must not be imported
 * where there is no DOM. This was `next/dynamic` with `ssr: false` — a Next
 * API, and the last thing pinning the docs surface to a Next app. `lazy` plus
 * a mount gate is the framework-free equivalent.
 */
export function DocMarkdownEditor(props: ComponentProps<typeof LazyEditor>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <EditorSkeleton />;
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <LazyEditor {...props} />
    </Suspense>
  );
}
