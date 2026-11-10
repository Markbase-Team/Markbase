// The document surface: the bordered, scrollable box a ProseMirror view mounts
// into. Shared so the read-only version view renders in exactly the same frame
// as the live editor — same padding, border, prose typography, and a min-height
// that lets the document fill the box. Keep editor and version UIs identical.
export const DOC_SURFACE_CLASS =
  "prose prose-sm min-h-0 max-w-none flex-1 overflow-y-auto rounded-lg border bg-background p-4 [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none";
