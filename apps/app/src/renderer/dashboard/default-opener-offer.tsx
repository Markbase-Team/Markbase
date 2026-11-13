import { useEffect } from "react";
import { toast } from "sonner";
import type { DefaultOpenerBridge } from "../../preload";

// The one-time offer to open markdown files with Markbase: a small toast at
// the top of the main window, the first time it shows a signed-in account.
//
// Main decides whether there is anything to offer (a packaged app on a Mac,
// not the default already, never offered before) and records that it was —
// see ../../default-opener.ts. This only draws the answer. It stays up until
// it is answered or dismissed: it appears once, so it should not also time out
// while the person is looking at something else.

const TOAST_ID = "default-markdown-opener";

export function DefaultOpenerOffer({ defaultOpener }: { defaultOpener: DefaultOpenerBridge }) {
  useEffect(() => {
    let live = true;
    void defaultOpener.shouldOffer().then((offer) => {
      if (!live || !offer) return;
      toast("Make Markbase your default app for markdown files?", {
        id: TOAST_ID,
        position: "top-center",
        duration: Infinity,
        // The top of the window is the header, a drag region that would take
        // the clicks meant for the buttons.
        className: "[-webkit-app-region:no-drag]",
        // The brand's lime, with near-black ink on it — the primary action.
        actionButtonStyle: { background: "#e5ff6e", color: "#18181b", fontWeight: 600 },
        action: {
          label: "Make default",
          onClick: () => {
            void defaultOpener.accept().then((ok) => {
              if (ok) toast.success("Markdown files now open in Markbase", { position: "top-center" });
              else {
                toast.error("Couldn't change the default app", {
                  description: "In Finder, choose Get Info on a .md file, then Open with › Markbase › Change All.",
                  position: "top-center",
                });
              }
            });
          },
        },
        cancel: { label: "Not now", onClick: () => {} },
      });
    });
    return () => {
      live = false;
    };
  }, [defaultOpener]);
  return null;
}
