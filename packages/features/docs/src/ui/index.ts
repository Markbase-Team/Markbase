// What a shell mounts. The documents surface is three columns — sidebar, tab
// strip, and the active document — and DocsShell owns all of it, including the
// keep-alive stack that stops switching tabs remounting the editor.
//
// Everything else in this directory is the surface's own internals. A shell
// reaches one of them by subpath (`@markbase/docs/ui/crdt-editor`) only where
// it genuinely renders that piece on its own, as the published-document page
// and the CRDT route do.
export { DocsShell } from "./docs-shell";
export type { DocsRouting } from "./routing";
export {
  DocsPortsProvider,
  browserDocsPorts,
  type AgentPort,
  type CrdtPort,
  type DocsPorts,
  type LinksPort,
  type LocalFilePort,
  type TabMenuPort,
  type VaultsPort,
} from "./ports";
