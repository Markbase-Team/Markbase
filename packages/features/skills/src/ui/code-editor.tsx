"use client";

import { Suspense, lazy, useEffect, useState, type ComponentProps } from "react";

const LazyEditor = lazy(() => import("./code-editor-cm"));

const EditorSkeleton = () => (
  <div className="h-full w-full animate-pulse rounded-lg bg-muted/40" />
);

/**
 * The skill file editor, loaded on demand and never on the server.
 *
 * CodeMirror touches the DOM as it builds. This was `next/dynamic` with
 * `ssr: false`; `lazy` plus a mount gate is the framework-free equivalent.
 */
export function CodeEditor(props: ComponentProps<typeof LazyEditor>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <EditorSkeleton />;
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <LazyEditor {...props} />
    </Suspense>
  );
}
