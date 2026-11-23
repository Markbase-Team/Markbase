"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Embed mode: the documents surface shown full page inside an AI app's card
 * (docs/embed-proof.md). It is a focused view — the files list and the
 * document, to read and edit — so the parts that belong to the whole app stay
 * out: sharing, publishing, downloading, the analytics / comments / history /
 * agent panels, new tabs, and the "connect an agent" prompt (the person is in
 * their agent already).
 *
 * The shell decides (the frame's marker cookie, or ?embed=1) and provides it;
 * a component asks with useEmbedMode(). Outside a provider it is off.
 */
const EmbedModeContext = createContext(false);

export function EmbedModeProvider({ embed, children }: { embed: boolean; children: ReactNode }) {
  return <EmbedModeContext.Provider value={embed}>{children}</EmbedModeContext.Provider>;
}

export function useEmbedMode(): boolean {
  return useContext(EmbedModeContext);
}
