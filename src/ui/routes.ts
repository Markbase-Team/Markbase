/**
 * Where this feature's page lives — named, not spelled out.
 *
 * Augments core's empty `ShellRoutes` so the shell answers with whatever this
 * means there. The old /dashboard/inbox page redirects here, and asking the
 * shell for the destination by name is how a package sends someone to a page
 * without spelling a URL it does not own.
 */
declare module "@markbase/ui/navigation" {
  interface ShellRoutes {
    /** The Attention page: the boards, with the inbox as a tab. */
    attention(): string;
  }
}

export {};
