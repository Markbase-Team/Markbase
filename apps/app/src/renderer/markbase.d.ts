import type { MarkbaseBridge } from "../preload";

// What the preload bridge puts on the window, for the pages this app renders.
//
// A union over the window kinds: a page does not know which slice it was given
// until it asks (renderer/shell.ts narrows it by the kind the page expects).
// Nothing outside this app declares `window.markbase` — the feature packages
// take what they need as ports, and never read the global.
declare global {
  interface Window {
    markbase?: MarkbaseBridge;
  }
}

export {};
