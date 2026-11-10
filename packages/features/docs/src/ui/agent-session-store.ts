"use client";

import type { ChatTurn } from "@markbase/agent";

/**
 * The conversation you are currently having with the agent, per vault — held
 * above the chat docks so it survives them.
 *
 * There is not one dock. The workspace keeps every open document mounted and
 * toggles them with display:none, so there is an AgentChatDock per open doc, and
 * a fourth one appears and disappears each time the side panel switches between
 * Comments and Claude. A conversation kept inside a dock therefore belonged to
 * one document and evaporated on a tab switch: every doc you opened started a
 * fresh session, and My Vault accumulated five separate chats about one file.
 *
 * Claude Code has no notion of an "active" session — only "the most recent
 * conversation in this directory" (`--continue`). This mirrors that: one current
 * conversation per vault, which travels with you across documents until you
 * deliberately start a new one. The vault is the right scope because it is also
 * the agent's cwd, so every document in it already shares one transcript store.
 */
export interface CurrentSession {
  /** Our record id in the `.chat/` index. */
  recordId: string;
  /** Claude's session id — the resume handle and transcript filename. */
  providerSessionId: string;
  createdAt: string;
  /** First user message: the record's title and preview. */
  firstPrompt: string;
}

const current = new Map<string, CurrentSession>();
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

export function getCurrentSession(vaultId: string): CurrentSession | null {
  return current.get(vaultId) ?? null;
}

export function setCurrentSession(vaultId: string, session: CurrentSession): void {
  const held = current.get(vaultId);
  if (
    held &&
    held.recordId === session.recordId &&
    held.providerSessionId === session.providerSessionId
  ) {
    // Same conversation, later turn. Storing it again would tell every other dock
    // to reload a transcript it already has.
    current.set(vaultId, session);
    return;
  }
  current.set(vaultId, session);
  announce();
}

/** Deliberately start over — the New chat button, and only that. */
export function clearCurrentSession(vaultId: string): void {
  if (!current.delete(vaultId)) return;
  announce();
}

export function subscribeCurrentSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Transcripts, deduped by session id.
 *
 * Every mounted dock adopts the vault's current conversation, so without this a
 * vault with six documents open would fetch the same transcript six times over
 * IPC the moment you switched conversations.
 */
const transcripts = new Map<string, Promise<ChatTurn[] | null>>();

export function loadTranscript(
  vaultId: string,
  providerSessionId: string,
  fetchTurns: (vaultId: string, sessionId: string) => Promise<ChatTurn[] | null>
): Promise<ChatTurn[] | null> {
  const key = `${vaultId}:${providerSessionId}`;
  let pending = transcripts.get(key);
  if (!pending) {
    // Not cached on rejection: a transcript that failed to load should be
    // retried, not remembered as missing for the rest of the app's life.
    pending = fetchTurns(vaultId, providerSessionId).catch(() => null);
    transcripts.set(key, pending);
  }
  return pending;
}

/** Forget a cached transcript — it has grown since we read it. */
export function invalidateTranscript(vaultId: string, providerSessionId: string): void {
  transcripts.delete(`${vaultId}:${providerSessionId}`);
}
