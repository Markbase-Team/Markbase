import { Apple } from "lucide-react";
import { MAC_DOWNLOAD_URL } from "@markbase/protocol/downloads";
import { cn } from "./utils";

/**
 * The one "Download for Mac" button, used everywhere the app is offered: the
 * landing page, the join page and the New Vault dialog.
 *
 * It links to MAC_DOWNLOAD_URL, GitHub's `releases/latest/download/…`
 * permalink, so publishing a build (apps/app/scripts/publish-dmg.sh) updates
 * every button at once, with no code change. Nothing overrides the address:
 * one URL, one button.
 *
 * `version` is a label only ("· v2.1.0"), passed by server pages that read the
 * newest tag; it is left off when it is not known.
 */
export function DownloadButton({
  version,
  size = "default",
  className,
}: {
  version?: string | null;
  /** "sm" for a compact bar, such as the landing nav. */
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <a
      href={MAC_DOWNLOAD_URL}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-800 active:scale-[0.98]",
        size === "sm" ? "h-9 px-4" : "h-11 px-5",
        className
      )}
    >
      <Apple className="size-4" />
      Download for Mac
      {version && <span className="font-normal text-zinc-400">· v{version}</span>}
    </a>
  );
}
