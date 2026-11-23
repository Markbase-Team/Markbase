"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Embed mode: the documents surface shown full page inside an AI app's card
 * (docs/embed-proof.md). The surface is all there — the files list, the
 * editor, comments, history, Share and Publish — and only what belongs to the
 * rest of the app stays out. The shell drops its own nav, settings and account
 * menu; inside the surface, embed mode drops Download (a framed page cannot be
 * relied on to save a file), the desktop app's download prompts and the
 * "connect an agent" dialog (the person is in their agent already).
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
