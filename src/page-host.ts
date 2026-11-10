import type { AnchorHTMLAttributes, ComponentType, ReactNode } from "react";
import type { FeatureId } from "@markbase/protocol/features";
import type { ShellRoutes } from "./navigation";

/**
 * What a feature's server-rendered page needs from the shell that mounts it.
 *
 * A page that only renders a client component needs nothing. The few that
 * decide something before rendering — who is signed in, whether this person
 * may see the page, whether the row in the URL exists — used to reach for
 * `next/headers` and `next/navigation` to find out, which pinned the page to
 * one shell. This is the port instead: the shell answers these six questions
 * its own way (`apps/web/src/lib/page-host.tsx`), and the page is rendered
 * with the answer in hand.
 *
 * Deliberately small, like the navigation port: it is what the moved pages
 * actually use, measured rather than guessed.
 */
export interface Viewer {
  id: string;
  email: string | null;
}

export interface PageHost {
  /** The signed-in person, or null. */
  viewer(): Promise<Viewer | null>;
  /** Send the person elsewhere. Never returns. */
  redirect(href: string): never;
  /** Render the shell's not-found page. Never returns. */
  notFound(): never;
  /**
   * Gate on a Claude-Code-only feature: a person without one is sent to the
   * page that explains how to get it, rather than shown a surface that can
   * never run anything.
   */
  requireFeature(id: FeatureId): Promise<void>;
  /** Named destinations this shell owns. See ShellRoutes. */
  routes: ShellRoutes;
  /** The shell's link component, for a page rendered on the server. */
  Link: ComponentType<
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }
  >;
}

/** The props a contributed `page` receives: Next's, plus the host. */
export interface FeaturePageProps<
  Params extends object = object,
  Search extends object = object,
> {
  params: Promise<Params>;
  searchParams: Promise<Search>;
  host: PageHost;
}

/** The props a contributed `layout` receives: Next's, plus the host. */
export interface FeatureLayoutProps<Params extends object = object> {
  params: Promise<Params>;
  children: ReactNode;
  host: PageHost;
}
