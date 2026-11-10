// The menu bar extra: the app's face while its window is closed.
//
// Closing the window hides it (see createWindow) and the app keeps syncing
// vaults and running tickets with nothing on screen. Dropbox's cloud icon is
// the model: a process that works in the background shows that it is there,
// says what it is doing, and offers the two things a person wants from it —
// open it, or stop it. Without the icon, "is Markbase running?" is a trip to
// Activity Monitor, and Quit is a Dock right-click nobody finds.
//
// The menu is BUILT ON EVERY CLICK rather than set once. A context menu set with
// setContextMenu is a snapshot — it would still say "3 vaults syncing" after
// the last one was unmounted — and the state it reports changes under it
// constantly (a ticket starting, a sign-out). Building fresh costs a few
// milliseconds on a click; the host supplies the items, so this file knows
// nothing about vaults or tickets.

import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";
import tray1x from "../build/trayTemplate.png";
import tray2x from "../build/trayTemplate@2x.png";

export interface TrayDeps {
  /** What the menu says and does, right now. */
  items: () => MenuItemConstructorOptions[];
}

// Held for the life of the process: a Tray with no reference is collected,
// and with it the icon vanishes from the bar.
let tray: Tray | null = null;

export function installTray(deps: TrayDeps): void {
  if (tray) return;
  // A template image — black plus alpha — which macOS tints itself: dark in
  // the light menu bar, light in the dark one, and highlighted while the menu
  // is open. The two representations are the 1x and Retina sizes; the build
  // script makes both from the logo (scripts/make-icon.mjs).
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({ scaleFactor: 1, dataURL: tray1x });
  icon.addRepresentation({ scaleFactor: 2, dataURL: tray2x });
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip("Markbase");
  const open = (): void => {
    tray?.popUpContextMenu(Menu.buildFromTemplate(deps.items()));
  };
  tray.on("click", open);
  tray.on("right-click", open);
}
