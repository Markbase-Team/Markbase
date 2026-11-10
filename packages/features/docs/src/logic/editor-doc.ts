// Open a document for the browser editor (roadmap F1, browser half).
//
// A real document already has content (its markdown / doc_json) before it ever
// has a CRDT snapshot. On the first CRDT open we seed the Y.Text from that
// content so it becomes the document's initial CRDT state; on every subsequent
// open the cloud CRDT is the truth and the server render is ignored. This is the
// browser counterpart to VaultSync's open-time reconcile, minus the disk.

import * as Y from "yjs";
import { createDoc } from "./crdt";
import { SyncSession, type DocStore, type DocPubSub } from "./transport";

export interface OpenedDoc {
  doc: Y.Doc;
  session: SyncSession;
  /** True when we seeded the CRDT from initialMarkdown (the cloud was empty). */
  seeded: boolean;
}

export async function openEditorDoc(
  docId: string,
  initialMarkdown: string,
  store: DocStore,
  pubsub: DocPubSub
): Promise<OpenedDoc> {
  // One read of the snapshot, used twice: to decide whether to seed, and (handed
  // to the session) to hydrate. Loading it again inside SyncSession.open cost
  // every doc open a second round trip for bytes we already had.
  const persisted = await store.load(docId);
  const seeded = persisted === null;
  // Seed only when the cloud is empty; otherwise start blank and let the session
  // hydrate the authoritative CRDT state (no fresh insert that would duplicate).
  const doc = createDoc(seeded ? initialMarkdown : "");
  const session = await SyncSession.open(docId, doc, store, pubsub, persisted);
  return { doc, session, seeded };
}
