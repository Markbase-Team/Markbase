"use client";

import { ArrowLeft } from "lucide-react";
import { useNavigation } from "./navigation";

// The shared header bar for every dashboard page. It always carries a back
// button (mobile only — desktop uses the hover sidebar) that returns to the
// full-screen menu at /dashboard. Pages pass a `title` and/or richer `children`
// (e.g. a project's Board/Secrets/Work Logs/MCP tabs).
export function PageHeader({
  title,
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  const { Link } = useNavigation();
  return (
    <div className="sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b bg-background">
      <Link
        href="/dashboard"
        aria-label="Back to menu"
        className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
      >
        <ArrowLeft className="size-5" />
      </Link>
      {title ? (
        <span className="shrink-0 text-sm font-medium">{title}</span>
      ) : null}
      {children}
    </div>
  );
}
