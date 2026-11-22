"use client";

import { Suspense, lazy, useEffect, useState, type ComponentProps } from "react";

const LazyEditor = lazy(() => import("./markdown-editor-crepe"));

const EditorSkeleton = () => (
  <div className="h-[var(--md-h,308px)] w-full animate-pulse rounded-lg border bg-muted/40" />
);

/**
 * The markdown editor, loaded on demand and never during a server render.
 *
 * Milkdown Crepe touches the DOM as it builds, so the chunk must not be
 * imported where there is no DOM. This was `next/dynamic` with `ssr: false` —
 * a Next API, which would have made every package importing this editor
 * renderable only by a Next app. `lazy` plus a mount gate is the framework-free
 * equivalent: the gate is what replaces `ssr: false`.
 */
export function MarkdownEditor(props: ComponentProps<typeof LazyEditor>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <EditorSkeleton />;
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <LazyEditor {...props} />
    </Suspense>
  );
}
