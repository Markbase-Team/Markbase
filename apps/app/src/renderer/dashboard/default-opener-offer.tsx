import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, FileText, X } from "lucide-react";
import { Button } from "@markbase/ui/button";
import type { DefaultOpenerBridge } from "../../preload";

// The one-time offer to open markdown files with Markbase: a small card that
// drops in at the top of the main window, the first time it shows a
// signed-in account.
//
// Main decides whether there is anything to offer (a packaged app on a Mac,
// not the default already, never offered before) and records that it was —
// see ../../default-opener.ts. This only draws the question and the answer.
// It stays until it is answered or closed: it appears once, so it should not
// also time out while the person is looking at something else.
//
// Its own card rather than a sonner toast: a question with two answers reads
// as one line with room, and a toast's fixed width broke it over three.

type Phase = "hidden" | "asking" | "working" | "done";

/** How long the "done" confirmation stays before the card leaves. */
const DONE_MS = 2400;

export function DefaultOpenerOffer({ defaultOpener }: { defaultOpener: DefaultOpenerBridge }) {
  const [phase, setPhase] = useState<Phase>("hidden");

  useEffect(() => {
    let live = true;
    void defaultOpener.shouldOffer().then((offer) => {
      if (live && offer) setPhase("asking");
    });
    return () => {
      live = false;
    };
  }, [defaultOpener]);

  useEffect(() => {
    if (phase !== "done") return;
    const timer = setTimeout(() => setPhase("hidden"), DONE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  async function accept() {
    setPhase("working");
    if (await defaultOpener.accept()) {
      setPhase("done");
      return;
    }
    setPhase("hidden");
    toast.error("Couldn't change the default app", {
      description: "In Finder, choose Get Info on a .md file, then Open with › Markbase › Change All.",
    });
  }

  if (phase === "hidden") return null;
  const done = phase === "done";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-4">
      <div
        role="status"
        // no-drag: it floats over the header row, a window drag region that
        // would otherwise take the clicks meant for the buttons.
        className="pointer-events-auto [-webkit-app-region:no-drag] flex max-w-full animate-in items-center gap-3 rounded-xl bg-popover py-2 pr-2 pl-2.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-200 fade-in-0 slide-in-from-top-2"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#e5ff6e] text-zinc-900">
          {done ? <Check className="size-4" /> : <FileText className="size-4" />}
        </span>
        {done ? (
          <p className="pr-2 text-sm font-medium">Markdown files now open in Markbase</p>
        ) : (
          <>
            <div className="min-w-0 pr-1">
              <p className="truncate text-sm font-medium">Open markdown files with Markbase</p>
              <p className="truncate text-xs text-muted-foreground">
                Make it the default app for .md files on this Mac.
              </p>
            </div>
            <Button
              size="sm"
              disabled={phase === "working"}
              onClick={() => void accept()}
              className="shrink-0 bg-[#e5ff6e] font-semibold text-zinc-900 hover:bg-[#e5ff6e] hover:brightness-95"
            >
              Set as default
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Not now"
              title="Not now"
              onClick={() => setPhase("hidden")}
              className="shrink-0 text-muted-foreground"
            >
              <X className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
