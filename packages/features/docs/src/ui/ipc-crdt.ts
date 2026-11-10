"use client";

// The desktop implementation of the CRDT transport.
//
// `DocStore` and `DocPubSub` (packages/docs/src/transport.ts) describe what the
// sync engine needs — load/save some bytes, publish/subscribe some updates — and
// `SyncSession` is handed them rather than importing one. That seam is why this
// file can exist without touching the engine, the binding, or the editor.
//
// There are three implementations of that pair, and they differ only in who
// is on the other end:
//
//   1. The web API + Realtime — the website's renderer talks to the cloud
//      itself: snapshots through the API, live deltas over a private channel
//      its session may join.
//   2. The web API, polled — the vault daemon in Electron's main process and
//      the CLI, keeping a mounted vault's `.md` files and the cloud in step
//      with nothing but an API key.
//   3. THIS ONE — the renderer asks Electron's main process, which answers from
//      a snapshot on disk and keeps that snapshot fresh from the API.
//
// Everything crosses IPC here. Until security lockdown stage 2 the renderer
// kept its own Realtime connection for live deltas, joined as the anonymous
// role with the publishable key; private channels have no place for that
// role, and the main process — which holds the API key — now polls the API for
// what changed and pushes it down. Each push is a whole snapshot, and applying
// a whole snapshot to a Y.Doc is a merge in Yjs, indistinguishable from any
// other update. Publishing is nothing: the save that follows every edit
// carries it to the server, which broadcasts it to the browsers.

import type { DocPubSub, DocStore } from "@markbase/docs";
import type { CrdtPort } from "./ports";

// The port is handed in rather than read off the window: which process serves
// snapshots is the shell's knowledge, and the shell says so by supplying a
// CrdtPort (or none) in DocsPorts — see ports.tsx.

/** Snapshots, served by the main process from disk. */
class IpcDocStore implements DocStore {
  constructor(private readonly api: CrdtPort) {}

  load(docId: string): Promise<Uint8Array | null> {
    return this.api.load(docId);
  }

  save(docId: string, snapshot: Uint8Array): Promise<void> {
    return this.api.save(docId, snapshot);
  }
}

/**
 * What main pushes down: the snapshots it refreshed from the API — a stale
 * cache catching up, and every change the poll found since.
 */
class DesktopDocPubSub implements DocPubSub {
  constructor(private readonly api: CrdtPort) {}

  publish(): void {
    // The save carries the edit; main hands it to the API, which broadcasts.
  }

  subscribe(docId: string, onUpdate: (update: Uint8Array) => void): () => void {
    return this.api.onUpdate(docId, onUpdate);
  }
}

/**
 * The desktop transport: the host's snapshots, and the host's pushes. A
 * browser has no port to build this from and talks to the cloud itself.
 */
export function desktopTransport(api: CrdtPort): { store: DocStore; pubsub: DocPubSub } {
  return { store: new IpcDocStore(api), pubsub: new DesktopDocPubSub(api) };
}
