"use client";

import { cn } from "./utils";
import { useNavigation } from "./navigation";

export type TabItem = {
  key: string;
  label: string;
  Icon?: React.ComponentType<{ className?: string }>;
  /** Navigation tab (a link). */
  href?: string;
  /** Local-state tab (a button). */
  onClick?: () => void;
};

// Shared tab strip used by the project tabs and the Attention tabs, so they
// always look identical. Supports both navigation tabs (href) and local-state
// tabs (onClick). The active tab's underline overlaps the container's bottom
// border via -mb-px, so the parent owns the `border-b`. Scrolls horizontally,
// never wraps.
export function TabBar({
  tabs,
  activeKey,
  className,
}: {
  tabs: TabItem[];
  activeKey: string;
  className?: string;
}) {
  const { Link } = useNavigation();
  return (
    <nav
      className={cn(
        "flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-clip whitespace-nowrap",
        className
      )}
    >
      {tabs.map((t) => {
        const isActive = t.key === activeKey;
        const cls = cn(
          "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
          isActive
            ? "border-foreground font-medium text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        );
        const inner = (
          <>
            {t.Icon && <t.Icon className="size-4" />}
            {t.label}
          </>
        );
        return t.href ? (
          <Link key={t.key} href={t.href} className={cls}>
            {inner}
          </Link>
        ) : (
          <button key={t.key} type="button" onClick={t.onClick} className={cls}>
            {inner}
          </button>
        );
      })}
    </nav>
  );
}
