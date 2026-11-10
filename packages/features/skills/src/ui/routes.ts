/**
 * Where this feature's pages live — named, not spelled out.
 *
 * Augments core's empty `ShellRoutes` so the shell answers with whatever these
 * mean there. `apiKeys` is not this feature's page: the workspace links to it
 * when a skill needs a key, and asking the shell for it by name is how a
 * feature points somewhere it does not own.
 */
declare module "@markbase/ui/navigation" {
  interface ShellRoutes {
    /** The skills list. */
    skills(): string;
    /** One skill's workspace. */
    skill(id: string): string;
    /** The API keys page, which this feature links to but does not own. */
    apiKeys(): string;
  }
}

export {};
