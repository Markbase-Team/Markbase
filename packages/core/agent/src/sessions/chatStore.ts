// The `.chat/` index: one JSON file per conversation, holding the metadata the SDK
// doesn't track (doc links + title). Lives in the vault's hidden `.chat/` folder,
// which the vault daemon ignores (dotfolder), so it never syncs as a document.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatSessionMeta } from "./types";

const chatDir = (vaultDir: string): string => join(vaultDir, ".chat");
const fileFor = (vaultDir: string, id: string): string =>
  join(chatDir(vaultDir), `${id}.json`);

/** Create or update a session's index record (keyed by our stable `id`). */
export function saveChatSession(vaultDir: string, meta: ChatSessionMeta): void {
  const dir = chatDir(vaultDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fileFor(vaultDir, meta.id), JSON.stringify(meta, null, 2), "utf8");
}

/** One session's index record by our stable id, or null if we don't track it. */
export function getChatSession(vaultDir: string, id: string): ChatSessionMeta | null {
  const file = fileFor(vaultDir, id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ChatSessionMeta;
  } catch {
    return null; // a half-written or hand-edited file must never crash the list
  }
}

/**
 * Every session we track in this vault, newest first. Pass `docId` to get only the
 * conversations attached to one document (the doc→sessions half of the link).
 */
export function listChatSessions(vaultDir: string, docId?: string): ChatSessionMeta[] {
  const dir = chatDir(vaultDir);
  if (!existsSync(dir)) return [];
  const out: ChatSessionMeta[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(readFileSync(join(dir, name), "utf8")) as ChatSessionMeta;
      if (!docId || meta.docIds.includes(docId)) out.push(meta);
    } catch {
      // skip a corrupt record rather than failing the whole list
    }
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return out;
}

/** Forget a session by our stable id (its ~/.claude transcript is the SDK's). */
export function deleteChatSession(vaultDir: string, id: string): void {
  const file = fileFor(vaultDir, id);
  if (existsSync(file)) rmSync(file);
}
