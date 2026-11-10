"use client";

import { useCallback, useEffect, useState } from "react";
import type { OwnerKind, Ticket } from "@markbase/protocol/types";
import { refreshGet } from "@markbase/ui/app-cache";

const SESSIONS_URL = "/api/v1/agent-sessions";
/** Collapse the simultaneous reads several mounted components make. */
const SESSIONS_DEDUPE_MS = 5_000;

// A ticket's agent assignee is one of the user's *named agent sessions* (from the
// Agents page) — not a raw API-key connection.
export type AgentSessionLite = {
  id: string;
  name: string;
  status: "pending" | "active" | "idle" | "ended" | "missing";
  provider: string;
  last_active: string | null;
};

// The owner's agent sessions, newest first, and whether work can be handed to
// them at all (Claude Code installed — see @markbase/protocol features.ts).
// `reload` refetches after one is created. `enabled: false` asks nothing and
// answers an empty roster — for a surface with no API behind it, such as the
// desktop's file window, where the request would only be refused.
export function useAgentSessions(enabled = true): {
  sessions: AgentSessionLite[];
  /** False when the user has no Claude Code, so no agent can run a ticket. */
  canDispatch: boolean;
  loaded: boolean;
  reload: () => void;
} {
  const [sessions, setSessions] = useState<AgentSessionLite[]>([]);
  // Assume dispatchable until told otherwise, so the picker doesn't flash a lock
  // at users who have Claude Code.
  const [canDispatch, setCanDispatch] = useState(true);
  const [loaded, setLoaded] = useState(!enabled);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        // Several components mount this hook at once (the board, the assignee
        // picker, the doc chrome), and each mount used to be its own round trip.
        // Sharing one cached read collapses them; `reload` (nonce) still forces a
        // fresh one after a session is created or ended.
        const d = await refreshGet<{
          sessions?: AgentSessionLite[];
          canDispatch?: boolean;
        }>(SESSIONS_URL, nonce === 0 ? SESSIONS_DEDUPE_MS : 0);
        if (!cancelled) {
          setSessions(d.sessions ?? []);
          setCanDispatch(d.canDispatch ?? true);
        }
      } catch {
        // best-effort — an empty roster just means "Me" + New
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce, enabled]);

  return { sessions, canDispatch, loaded, reload };
}

// ---- Assignee encoding -------------------------------------------------------
// A select value is "user" (Me) or `agent:<agent_session_id>`.

type OwnerFields = Pick<Ticket, "owner_kind" | "agent_session_id">;

export function ownerSelectValue(t: OwnerFields): string {
  return t.owner_kind === "agent" ? `agent:${t.agent_session_id ?? ""}` : "user";
}

export function parseOwnerValue(v: string): {
  ownerKind: OwnerKind;
  agentSessionId: string | null;
} {
  if (v.startsWith("agent:")) {
    return { ownerKind: "agent", agentSessionId: v.slice("agent:".length) || null };
  }
  return { ownerKind: "user", agentSessionId: null };
}

// "Me" + each session. When `current` isn't in the list (a legacy agent ticket, or
// a session beyond the recent slice) a fallback option keeps the select coherent.
export function ownerOptions(
  sessions: AgentSessionLite[],
  current?: string
): { value: string; label: string }[] {
  const opts = [
    { value: "user", label: "Me" },
    ...sessions.map((s) => ({ value: `agent:${s.id}`, label: s.name })),
  ];
  if (current && !opts.some((o) => o.value === current)) {
    opts.push({ value: current, label: "Agent" });
  }
  return opts;
}

export function ownerLabel(t: OwnerFields, sessions: AgentSessionLite[]): string {
  if (t.owner_kind !== "agent") return "Me";
  return sessions.find((s) => s.id === t.agent_session_id)?.name ?? "Agent";
}

export function ownerMatchesFilter(t: OwnerFields, value: string): boolean {
  const { ownerKind, agentSessionId } = parseOwnerValue(value);
  if (ownerKind === "user") return t.owner_kind === "user";
  return t.owner_kind === "agent" && t.agent_session_id === agentSessionId;
}
