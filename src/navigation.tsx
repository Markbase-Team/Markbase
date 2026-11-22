"use client";

import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type ComponentType,
  type ReactNode,
} from "react";

/**
 * What a feature needs from whatever is routing the app.
 *
 * Feature UI navigates: the docs shell reads the vault out of the query, the
 * tab bar pushes a document's URL, the vault tree refreshes after a rename.
 * Reaching for `next/navigation` to do that is what would pin every one of
 * those components to a Next app forever — so they ask for this instead, and
 * the shell answers.
 *
 * Deliberately four members. It is the whole surface the feature packages
 * actually use, measured rather than guessed, and a port this small is cheap
 * for a second shell to implement.
 */
/**
 * Named destinations the shell owns, declared by whoever needs them.
 *
 * Empty here on purpose. A feature that must link somewhere the shell decides —
 * projects linking to a project's Secrets tab, say — augments this interface
 * from its own package and the shell implements what it finds. Core never
 * learns any feature's route names, and a feature gets them typed:
 *
 *     declare module "@markbase/ui/navigation" {
 *       interface ShellRoutes { projectTab(slug: string, tab: Tab): string }
 *     }
 *
 * Declaring is claiming: the shell will not compile until it supplies every
 * key some shipped feature declared.
 */
export interface ShellRoutes {}

export interface Navigation {
  /** The current path, without the query string. */
  pathname: string;
  /** The current query string. */
  searchParams: { get(name: string): string | null };
  /** Navigate, pushing a history entry. */
  push(href: string): void;
  /**
   * Re-fetch what the current route rendered.
   *
   * Under Next this re-runs the server components; a client-only shell can
   * refetch its own data or do nothing. Either way the caller's meaning is
   * "what I am looking at is stale", not "re-run the server".
   */
  refresh(): void;
  /**
   * The shell's own link component.
   *
   * Passed in rather than rendered as a plain `<a>` so the web shell keeps
   * Next's prefetching, and a desktop shell can route without a page load.
   */
  /** Named destinations this shell owns. See ShellRoutes. */
  routes: ShellRoutes;
  Link: ComponentType<
    AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }
  >;
}

const NavigationContext = createContext<Navigation | null>(null);

export function NavigationProvider({
  value,
  children,
}: {
  value: Navigation;
  children: ReactNode;
}) {
  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

/**
 * The host's navigation. Throws when no shell provided one.
 *
 * Throwing rather than degrading to a no-op: a component that silently stops
 * navigating looks like a dead button, and the mistake — forgetting the
 * provider — is made once, at mount, by whoever is wiring up a shell.
 */
export function useNavigation(): Navigation {
  const nav = useContext(NavigationContext);
  if (!nav) {
    throw new Error(
      "No NavigationProvider above this component. A shell must supply one — " +
        "see apps/web's NextNavigation."
    );
  }
  return nav;
}
