import "./markbase.d";
import type { BridgeByKind, WindowKind } from "../preload";

/**
 * The preload bridge, for a page this app renders itself.
 *
 * Each page says which window it is the page OF, and gets that window's slice:
 * the dashboard gets vaults, the agent and the CRDT host; the viewer gets its
 * file. A page asking for a slice it was not given
 * is a mismatch between main.ts (which names the window kind when it makes the
 * window) and the page, and is reported as one.
 *
 * The declaration marks `window.markbase` optional because these components
 * are built with the same tooling as pages that run in a browser. These pages
 * are only ever served inside the shell, so here its absence is a build mistake
 * — the preload not loaded — and is reported rather than guarded around in
 * every page.
 */
export function shell<K extends WindowKind>(kind: K): BridgeByKind[K] {
  const bridge = window.markbase;
  if (!bridge) throw new Error("This page only works inside the Markbase app.");
  if (bridge.kind !== kind) {
    throw new Error(`This is the ${kind} page, but the window was opened as "${bridge.kind}".`);
  }
  return bridge as BridgeByKind[K];
}
