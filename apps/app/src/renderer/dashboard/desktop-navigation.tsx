import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { NavigationProvider, type Navigation } from "@markbase/ui/navigation";

// This shell's answer to the navigation port — the desktop counterpart of
// apps/web's NextNavigation.
//
// There is no router here, only the History API: the page is one built file that
// the markbase:// handler serves at every /dashboard path, so pushState moves the
// address without a load and a reload lands back on the same page. The documents
// surface writes its URLs with history.pushState/replaceState directly (Next's
// router patches those; this does the same), and reads `pathname` from the port,
// so both have to agree — the patch below is what keeps them in step.

function Link({
  href,
  onClick,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    // A modified click is "open elsewhere" on the web; here there is nowhere
    // else, so it falls through to the default and the handler in main.ts
    // decides what an off-app URL does.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.history.pushState(null, "", href);
  };
  return (
    <a href={href} onClick={go} {...rest}>
      {children}
    </a>
  );
}

interface Location {
  pathname: string;
  search: string;
}

function here(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function DesktopNavigation({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<Location>(here);

  useEffect(() => {
    const sync = () => setLoc(here());
    const { pushState, replaceState } = window.history;
    window.history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
      pushState.apply(this, args);
      sync();
    };
    window.history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
      replaceState.apply(this, args);
      sync();
    };
    window.addEventListener("popstate", sync);
    return () => {
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const searchParams = useMemo(() => new URLSearchParams(loc.search), [loc.search]);
  const push = useCallback((href: string) => window.history.pushState(null, "", href), []);
  // On the web this re-runs the Server Components behind the page. Nothing here
  // is server-rendered; re-reading the address is all "refresh" can mean.
  const refresh = useCallback(() => setLoc(here()), []);

  const value = useMemo<Navigation>(
    () => ({ pathname: loc.pathname, searchParams, push, refresh, routes: {}, Link }),
    [loc.pathname, searchParams, push, refresh]
  );
  return <NavigationProvider value={value}>{children}</NavigationProvider>;
}
