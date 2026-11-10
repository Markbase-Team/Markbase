import type { ComponentType } from "react";
import { MessageSquare, MousePointer2, SquareTerminal } from "lucide-react";
import type { AgentId } from "./agent-launcher";
import { ClaudeMark } from "./claude-mark";

// Each agent's chat should feel like that agent's real product, not a generic
// panel — Claude Code reads like its terminal (monospace transcript, Anthropic
// coral, ⏺ tool bullets, rotating spinner words); Codex/Cursor/Claude Desktop
// each carry their own identity. This is a deliberate departure from the app's
// lime brand: inside the dock we wear the agent's colours, not Markbase's.

export interface AgentTheme {
  /** Brand accent (hex) — the mark, the prompt caret, tool bullets, send button. */
  accent: string;
  /** Readable text on top of `accent`. */
  accentFg: string;
  /** Header mark. */
  icon: ComponentType<{ className?: string }>;
  /** A monospace transcript (CLI agents) vs. a sans chat (desktop/editor apps). */
  mono: boolean;
  /** User turns render as a `>`-prefixed prompt line (CLI) or an accent bubble. */
  userVariant: "prompt" | "bubble";
  /** Tool calls render as terminal bullets (CLI) or expandable cards (chat). */
  toolVariant: "terminal" | "card";
  /** Rotating labels shown while a turn streams (Claude Code's spinner words). */
  workingWords: string[];
  /** Empty-state greeting, in the agent's own voice. */
  greeting: string;
}

export const AGENT_THEMES: Record<AgentId, AgentTheme> = {
  "claude-code": {
    accent: "#d97757", // Anthropic coral / "book cloth"
    accentFg: "#ffffff",
    icon: ClaudeMark,
    mono: true,
    userVariant: "prompt",
    toolVariant: "terminal",
    workingWords: [
      "Cerebrating",
      "Percolating",
      "Ruminating",
      "Herding",
      "Noodling",
      "Simmering",
      "Conjuring",
      "Finagling",
    ],
    greeting: "Welcome to Claude Code. Ask about this vault — it runs in your local folder.",
  },
  codex: {
    accent: "#10a37f", // OpenAI green
    accentFg: "#ffffff",
    icon: SquareTerminal,
    mono: true,
    userVariant: "prompt",
    toolVariant: "terminal",
    workingWords: ["Thinking", "Working", "Reasoning", "Analyzing"],
    greeting: "Codex. Ask about this vault — it runs in your local folder.",
  },
  cursor: {
    accent: "#111111", // Cursor's near-black
    accentFg: "#ffffff",
    icon: MousePointer2,
    mono: false,
    userVariant: "bubble",
    toolVariant: "card",
    workingWords: ["Generating", "Thinking"],
    greeting: "Cursor. Ask about this vault.",
  },
  "claude-desktop": {
    accent: "#d97757",
    accentFg: "#ffffff",
    icon: MessageSquare,
    mono: false,
    userVariant: "bubble",
    toolVariant: "card",
    workingWords: ["Thinking"],
    greeting: "How can I help with this vault?",
  },
};

export function agentTheme(id: AgentId): AgentTheme {
  return AGENT_THEMES[id] ?? AGENT_THEMES["claude-code"];
}
