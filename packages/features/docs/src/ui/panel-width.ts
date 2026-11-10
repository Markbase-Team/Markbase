import { readLocalNumber, writeLocal } from "./local-store";

// The width of the document's right-hand panel, in one place.
//
// It is read by the workspace (which seeds the CSS variable both columns follow)
// and written by the drag handle inside DocView, and both of them had their own
// copy of the key, the bounds, and the 320 default — with the bounds appearing a
// third time, as bare numbers, in the drag's clamp. Three copies of a number
// that has to agree with itself for the panel to line up with the tab bar above
// it.

const KEY = "docPanelWidth";

/** Narrow enough to still be a panel; wide enough to read a conversation in. */
export const MIN_PANEL_WIDTH = 280;
export const MAX_PANEL_WIDTH = 900;
export const DEFAULT_PANEL_WIDTH = 320;

/** What the panel should open at: the width last dragged to, or the default. */
export function savedPanelWidth(): number {
  return readLocalNumber(KEY, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH) ?? DEFAULT_PANEL_WIDTH;
}

/** A pointer position turned into a width the panel is allowed to have. */
export function clampPanelWidth(px: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, px));
}

/** Remember the width, for the next time this surface opens. */
export function savePanelWidth(px: number): void {
  writeLocal(KEY, String(Math.round(px)));
}

/**
 * Drag a panel's left edge, from a pointerdown on it until the pointer comes up.
 *
 * With a `host` (the workspace node carrying `--doc-panel-w`) the width is
 * written straight to the variable while dragging, and `apply` hears it once at
 * the end: a drag that set state on every pointermove re-rendered every
 * kept-alive document sixty times a second to change one number. Without a host
 * (the guest page, one document and no workspace) every move goes to `apply`.
 * Either way the final width is remembered.
 */
export function startPanelDrag(opts: {
  /** The panel's right edge, in viewport px — a width is measured back from it. */
  rightEdge: number;
  host: HTMLElement | null;
  start: number;
  apply: (px: number) => void;
}): void {
  let last = opts.start;
  const onMove = (ev: PointerEvent): void => {
    last = clampPanelWidth(opts.rightEdge - ev.clientX);
    if (opts.host) opts.host.style.setProperty("--doc-panel-w", `${last}px`);
    else opts.apply(last);
  };
  const onUp = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // Now that it is over, tell React once — so the width survives the next
    // render, which would otherwise paint the pre-drag value back.
    if (opts.host) opts.apply(last);
    savePanelWidth(last);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}
