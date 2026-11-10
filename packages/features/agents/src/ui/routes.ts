/**
 * Where this feature links to — named, not spelled out.
 *
 * Augments core's empty `ShellRoutes` so the shell answers with whatever these
 * mean there. `apiKeys` is not this feature's page: the agents page links to
 * it as "connect an agent", and asking the shell for it by name is how a
 * feature points somewhere it does not own.
 */
declare module "@markbase/ui/navigation" {
  interface ShellRoutes {
    /** The API keys page, which this feature links to but does not own. */
    apiKeys(): string;
  }
}

export {};
