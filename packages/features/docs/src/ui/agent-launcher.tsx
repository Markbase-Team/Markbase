"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";
import { Braces, MessageSquare, SquareMousePointer } from "lucide-react";
import { ClaudeMark } from "./claude-mark";
import { useDocsPorts } from "./ports";

// "Open in agent" — one interface, two implementations. The UI (DocActionSet)
// only ever calls `AgentLauncher.open()`; it never branches on desktop vs web.
//
//   • Claude Code opens a NATIVE chat docked in the workspace (the Agent SDK runs
//     in the vault's local folder on desktop; web shows a desktop-only notice
//     until the cloud transport lands).
//   • The other agents (Codex / Cursor / Claude Desktop) still hand off to the
//     host's AgentPort to open the external app in the vault folder.

export type AgentId = "claude-code" | "codex" | "cursor" | "claude-desktop";

export type AgentInfo = {
  id: AgentId;
  name: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Listed, but not yet offered: the menu shows it disabled with a "Coming
   * soon" tag. The row stays so the menu reads the same everywhere and the
   * plan is visible; turning the agent on is deleting this flag.
   */
  comingSoon?: boolean;
};

// The agents shown in the menu. Same list everywhere; availability + behaviour
// come from the active launcher.
export const AGENTS: AgentInfo[] = [
  { id: "claude-code", name: "Claude Code", icon: ClaudeMark },
  { id: "codex", name: "Codex", icon: Braces },
  { id: "cursor", name: "Cursor", icon: SquareMousePointer, comingSoon: true },
  { id: "claude-desktop", name: "Claude Desktop", icon: MessageSquare, comingSoon: true },
];

/** Agents that render as a native in-app chat (the doc panel's Claude Code tab)
 *  rather than opening an external app — those are launched by the panel, not here. */
const NATIVE_CHAT: ReadonlySet<AgentId> = new Set<AgentId>(["claude-code"]);

export type AgentContext = { vaultId: string; docId?: string; docPath?: string };

export interface AgentLauncher {
  /** How this environment opens agents — for a hint in the menu header. */
  mode: "local" | "cloud";
  /** Whether this environment can open `id` (for disabling menu items). */
  available(id: AgentId): boolean;
  /** Open an EXTERNAL agent (Codex / Cursor / Claude Desktop) in the vault folder.
   *  Native chat (Claude Code) is opened by the doc panel, not through here. */
  open(id: AgentId, ctx: AgentContext): void;
}

const Ctx = createContext<AgentLauncher | null>(null);

/** The active launcher, or null where none is provided (e.g. the guest page). */
export function useAgentLauncher(): AgentLauncher | null {
  return useContext(Ctx);
}

export function AgentLauncherProvider({ children }: { children: ReactNode }) {
  // A host with an agent port can open agents in the vault's folder; a browser
  // (no port) cannot, and that is the whole local/cloud distinction here.
  const { agent } = useDocsPorts();

  const open = useCallback(
    (id: AgentId, ctx: AgentContext) => {
      if (NATIVE_CHAT.has(id)) return; // handled by the doc panel's Claude Code tab
      // External app, on a host that has one.
      if (agent) {
        void agent.open(id, ctx.vaultId, ctx.docId);
        return;
      }
      console.info(
        `[agent] open ${id} on doc ${ctx.docId ?? "?"} (vault ${ctx.vaultId}) — web cloud-session endpoint not wired yet`
      );
    },
    [agent]
  );

  const launcher = useMemo<AgentLauncher>(
    () => ({
      mode: agent ? "local" : "cloud",
      // Native chat is offered everywhere; external apps only where a host opens them.
      available: (id) => (NATIVE_CHAT.has(id) ? true : agent !== null),
      open,
    }),
    [agent, open]
  );

  return <Ctx.Provider value={launcher}>{children}</Ctx.Provider>;
}
