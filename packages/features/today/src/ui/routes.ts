/**
 * Where this feature links to — named, not spelled out.
 *
 * Today lists tasks, and each task is a document: `document` is where the
 * shell shows one. Not this feature's page, so it is asked of the shell by
 * name rather than built here.
 */
declare module "@markbase/ui/navigation" {
  interface ShellRoutes {
    /** One document, by id. */
    document(id: string): string;
  }
}

export {};
