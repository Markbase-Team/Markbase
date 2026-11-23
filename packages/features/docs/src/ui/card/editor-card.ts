// The document editor, inside an AI app's card (MCP Apps), with no frame.
//
// Claude will not frame markbase.so in a connector's card unless it has
// approved the site for that connector, but it runs a card's own page and
// passes the card's tool calls to our server with the connector's key. So the
// card carries the editor itself — the same Tiptap extensions and the same
// Yjs binding the app uses (@markbase/shared/docs) — and reads and writes the
// document through two card-only tools:
//
//   docs_readCrdt   GET  /docs/:id/crdt[?after=<version>]  the snapshot, or "unchanged"
//   docs_writeCrdt  POST /docs/:id/crdt { state }           merge a Yjs update
//
// There is no live channel (Supabase Realtime is another site the card may not
// reach), so other people's edits arrive by polling: a cheap "anything after
// version N?" every POLL_MS. Local edits are batched and merged in.
//
// This file is bundled into one script (apps/web/scripts/gen-editor-card.ts)
// and runs inside the card page beside its host bridge, `mb`
// (@markbase/shared/docs/apps/page). PROOF: one document, no comments,
// history or files list yet.

import { Editor } from "@tiptap/core";
import * as Y from "yjs";
import { EditorBinding, type EditorBridge } from "@markbase/shared/docs/editor-binding";
import { setMarkdown } from "@markbase/shared/docs/crdt";
import { docJsonToMarkdown } from "@markbase/shared/docs/markdown";
import { docExtensions } from "@markbase/shared/docs/extensions";
import type { DocJSON } from "@markbase/shared/docs/types";

/** How often to ask whether someone else changed the document. */
const POLL_MS = 1500;
/** How long typing may run before what was typed is sent. */
const WRITE_DELAY_MS = 400;
/** Updates applied from the server, so they are not sent back. */
const REMOTE = "remote";

/** What the card's bridge makes of a tool's answer. */
interface CrdtAnswer {
  state?: string | null;
  version?: number;
  unchanged?: boolean;
  doc?: { content?: string; title?: string };
}
interface ToolAnswer {
  data?: CrdtAnswer;
  error?: string;
}
interface ToolResultParams {
  content?: { type: string; text: string }[];
  isError?: boolean;
}
type ToolArgs = { [name: string]: string | number };

/** The card page's host bridge (packages/shared/src/docs/apps/page.ts). */
declare const mb: {
  on(method: string, handler: (params: ToolResultParams) => void): void;
  callTool(name: string, args: ToolArgs): Promise<ToolAnswer>;
  openLink(url: string): Promise<object>;
  start(info: { name: string; version: string; protocol: string }): void;
};
declare function readToolResult(params: ToolResultParams): { data?: { doc_id?: string | null }; error?: string };
declare const CONFIG: { protocol: string; docUrlPrefix: string; readTool: string; writeTool: string; contentTool: string };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing from the card`);
  return found;
}

function say(text: string, kind: "" | "error" = ""): void {
  const status = element("status");
  status.textContent = text;
  status.className = `status ${kind}`;
}

async function openDocument(docId: string): Promise<void> {
  const doc = new Y.Doc();
  let version = 0;

  // The document as stored. A document no editor has opened yet has no
  // snapshot; it is seeded from its markdown, as the app does.
  const first = await mb.callTool(CONFIG.readTool, { id: docId });
  if (first.error || !first.data) throw new Error(first.error ?? "The document could not be read.");
  if (first.data.state) {
    Y.applyUpdate(doc, fromBase64(first.data.state), REMOTE);
    version = first.data.version ?? 0;
  } else {
    const read = await mb.callTool(CONFIG.contentTool, { id: docId });
    setMarkdown(doc, read.data?.doc?.content ?? "");
  }

  const editor = new Editor({ element: element("editor"), extensions: docExtensions, content: "" });
  const bridge: EditorBridge = {
    readMarkdown: () => docJsonToMarkdown(editor.getJSON() as DocJSON),
    writeContent: (next) => editor.commands.setContent(next, { emitUpdate: false }),
  };
  const binding = new EditorBinding(doc, bridge);
  bridge.writeContent(binding.derive());
  editor.on("update", () => binding.editorChanged());

  element("open-in").addEventListener("click", () => {
    mb.openLink(CONFIG.docUrlPrefix + encodeURIComponent(docId)).catch(() => {});
  });

  // Local edits: batched, merged into the stored state. A failed write keeps
  // its updates for the next try, so nothing typed is lost to a blip.
  let pending: Uint8Array[] = first.data.state ? [] : [Y.encodeStateAsUpdate(doc)];
  let writing = false;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    writeTimer = null;
    if (writing || pending.length === 0) return;
    const update = Y.mergeUpdates(pending);
    pending = [];
    writing = true;
    say("Saving…");
    mb.callTool(CONFIG.writeTool, { id: docId, state: toBase64(update) }).then(
      (answer) => {
        writing = false;
        if (answer.error) {
          pending.unshift(update);
          say(`Not saved: ${answer.error}`, "error");
          return;
        }
        say("Saved");
        if (pending.length) schedule();
      },
      () => {
        writing = false;
        pending.unshift(update);
        say("Not saved: the assistant's app would not pass the edit on.", "error");
      }
    );
  };
  const schedule = (): void => {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(flush, WRITE_DELAY_MS);
  };
  doc.on("update", (update: Uint8Array, origin: string | null) => {
    if (origin === REMOTE) return;
    pending.push(update);
    schedule();
  });
  if (pending.length) schedule();

  // Everyone else's edits: ask whether there is anything after our version.
  let polling = false;
  setInterval(() => {
    if (polling || writing) return;
    polling = true;
    mb.callTool(CONFIG.readTool, { id: docId, after: version }).then(
      (answer) => {
        polling = false;
        const data = answer.data;
        if (!data || data.unchanged || !data.state) return;
        Y.applyUpdate(doc, fromBase64(data.state), REMOTE);
        version = data.version ?? version;
      },
      () => {
        polling = false;
      }
    );
  }, POLL_MS);

  say("Saved");
}

let opened = false;
mb.on("ui/notifications/tool-result", (params) => {
  const result = readToolResult(params);
  const docId = result.data?.doc_id;
  if (opened || result.error || typeof docId !== "string") {
    if (!opened) say(result.error ?? "There is no document to open.", "error");
    return;
  }
  opened = true;
  say("Opening…");
  openDocument(docId).catch((error: Error) => say(error.message, "error"));
});
mb.start({ name: "markbase-editor", version: "0.1.0", protocol: CONFIG.protocol });
