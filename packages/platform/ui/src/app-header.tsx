"use client";

import { cn } from "./utils";
import { useIsDesktop } from "./use-is-desktop";

// The class that opts an element OUT of the header's window-drag region — put it
// on anything interactive (buttons, inputs, tabs) so clicks still land. Also forces
// descendant SVGs to no-drag: an icon-only button's SVG doesn't inherit no-drag, so
// a real click would land on the SVG and macOS would drag the window instead. It's
// a no-op on the web (there's no drag region there), so apply it unconditionally.
export const headerNoDrag =
  "[-webkit-app-region:no-drag] [&_svg]:[-webkit-app-region:no-drag]";

/**
 * The unified top bar shared by every dashboard feature — a fixed-height row that
 * matches the documents surface: the feature's title/actions, and (on desktop) a
 * window-drag region so the frameless window moves and double-click-zoom works.
 *
 * The macOS traffic lights float over the icon rail's empty top-left (the rail
 * insets its nav below this same h-11 line), so this bar doesn't reserve space for
 * them itself. Wrap interactive children in `headerNoDrag` so they stay clickable.
 */
export function AppHeader({
  title,
  children,
  className,
}: {
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const isDesktop = useIsDesktop();
  return (
    <header
      className={cn(
        // Span the FULL app width: extend left over the icon rail (3rem) so the bar
        // sits across the whole top and the rail starts BELOW it. z above the rail
        // so it covers the rail's top-left.
        "relative z-30 -ml-12 flex h-11 w-[calc(100%+3rem)] shrink-0 items-center gap-2 border-b bg-background px-3",
        isDesktop && "[-webkit-app-region:drag]",
        className
      )}
    >
      {/* Reserve the macOS traffic-light width at the true left edge. */}
      {isDesktop && <div className="w-16 shrink-0" aria-hidden />}
      {title && <span className="shrink-0 text-sm font-semibold">{title}</span>}
      {children}
    </header>
  );
}
