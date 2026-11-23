import { z } from "zod";

// What a feature declares about itself, in `packages/<feature>/markbase.json`.
//
// One source of truth. The zod schema below is what the loader enforces, and
// `schemas/markbase-feature.schema.json` is GENERATED from it (see
// scripts/gen-feature-schema.ts) purely so editors can offer completion. Writing
// the JSON Schema by hand alongside a validator would be two things to keep in
// step, which is the failure this whole phase exists to remove.
//
// It is plain data on purpose: the build reads a manifest without importing the
// package it describes. That is the registration-not-import property R5 depends
// on — the moment the build imports each feature to ask what it contributes,
// the build becomes a hub that depends on everything and nothing can be left
// out again.

/** Where a sidebar entry may appear. Most of today's entries are owner-only. */

export const SidebarEntry = z
  .object({
    /** Stable id, unique across every feature. */
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, "lowercase kebab-case"),
    title: z.string().min(1),
    href: z.string().regex(/^\//, "must be an absolute path"),
    /**
     * A `lucide-react` export name, e.g. "FileText". A name, not a component:
     * the manifest is JSON and cannot hold one. The sidebar maps it, and a name
     * that does not resolve fails a test rather than rendering an empty square.
     */
    icon: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "a lucide export name"),
  })
  .strict();

/**
 * A path under `app/`, as Next names a route file: segments of lowercase
 * letters, digits, hyphens, dots and `[param]`, ending in the file kind.
 * No leading slash, no `..`, no group or private folder — the build decides
 * where in the app tree the stub lands.
 */
const SEGMENT = "(?:[a-z0-9]+(?:[.-][a-z0-9]+)*|\\[[a-z][A-Za-z0-9]*\\])";
export const APP_ROUTE_PATH = new RegExp(`^${SEGMENT}(?:/${SEGMENT})*/(route|page|layout)$`);

export const AppRoute = z.union([
  z.string().regex(APP_ROUTE_PATH, "a route file path under app/"),
  z
    .object({
      path: z.string().regex(APP_ROUTE_PATH, "a route file path under app/"),
      /** Seconds the function may run; Next reads it off the route file. */
      maxDuration: z.number().int().positive().optional(),
      /** The segment's rendering mode, when the default is wrong. */
      dynamic: z.enum(["force-dynamic", "force-static"]).optional(),
      /** The page's `<title>`, for a page that has one. */
      title: z.string().min(1).optional(),
    })
    .strict(),
]);

export type AppRoute = z.infer<typeof AppRoute>;

export const FeatureManifest = z
  .object({
    /** Stable feature id. This is what `MARKBASE_FEATURES` names. */
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, "lowercase kebab-case"),
    /**
     * The workspace package implementing it, when it has one.
     *
     * **Optional, and that is the point.** Owning a package is an accident of
     * how the code was split, not what makes something a feature: the reader,
     * terms, diary, skills, agents, today and the board all live in `apps/web`
     * and are every bit as droppable as docs. Requiring this field quietly
     * redefined "feature" as "feature that happens to be packaged", which left
     * most of them uncomposable. Only `transpilePackages` cares.
     */
    pkg: z
      .string()
      .regex(/^@markbase\/[a-z-]+$/, "a @markbase/* package name")
      .optional(),
    /** One line, for humans reading the manifest list. */
    summary: z.string().min(1),
    /**
     * Features this one cannot ship without, by id.
     *
     * The default is none, and a feature stays droppable on its own precisely
     * because nothing else imports it. A declared requirement is the one
     * exception: attention's page and its sweep compose email's inbox, and
     * that composition has to live in one of the two. Naming the edge here is
     * what keeps it honest — `enabledFeatures` refuses a build that names the
     * dependant without the dependency, and the boundary test allows exactly
     * the imports declared this way and no others.
     */
    requires: z
      .array(z.string().regex(/^[a-z][a-z0-9-]*$/, "a feature id"))
      .default([]),
    sidebar: z.array(SidebarEntry).default([]),
    /**
     * Path prefixes this feature owns — pages and API routes alike. When the
     * feature is left out of a build, these 404.
     *
     * Prefixes rather than exact paths because a feature owns a subtree, and
     * listing fourteen attention endpoints by hand is how one gets forgotten
     * and stays reachable in a build that was supposed to exclude it.
     */
    routes: z.array(z.string().regex(/^\//, "must be an absolute path")).default([]),
    /**
     * Centre-pane content types this feature can render (R6). Declared now so
     * the shape is settled; nothing consumes it yet.
     */
    centre: z.array(z.string()).default([]),
    /**
     * UI this feature supplies to the shell, as export subpaths of its package.
     *
     * `sidebar` is a component the shell renders in place of the plain link for
     * this feature's entry — a list, an action, live state. The shell used to
     * hold that code itself behind `if (entry.id === "projects")`, which made a
     * feature un-droppable and gave the shell a Realtime subscription to a
     * table it had no other reason to know about.
     *
     * Only a package can contribute: the build imports the subpath, and there
     * is nothing to import from a feature whose code is still in the app.
     */
    contributes: z
      .object({
        sidebar: z.string().regex(/^\.\//, "a './…' export subpath"),
        /**
         * React providers the shell wraps the whole surface in, outermost
         * first. A feature needing shared client state across the sidebar and
         * its pages puts it here instead of asking the shell to mount it.
         */
        providers: z
          .array(z.string().regex(/^\.\//, "a './…' export subpath"))
          .default([]),
        /**
         * A module augmenting core's `ShellRoutes` with the destinations this
         * feature needs the shell to name. Type-only: the generated slot module
         * imports it so the shell will not compile until its route table
         * answers every key a shipped feature declared.
         */
        routes: z.string().regex(/^\.\//, "a './…' export subpath"),
        /**
         * The Next route files this feature contributes to the web shell,
         * named by their path under `app/` — `dashboard/terms/page`,
         * `api/v1/terms/[id]/route`, `dashboard/projects/[slug]/layout`.
         *
         * The package mirrors that tree under `src/app/` and exports it as
         * `./app/*\/route`, `./app/*\/page` and `./app/*\/layout`; the build
         * writes one stub per entry into the app (see `appRouteStubs`) and
         * nothing else in the app names the package. A page or a layout gets
         * the shell's `PageHost`; a route module exports its handlers.
         *
         * The object form carries the segment config Next reads off the route
         * file itself and would not see through a re-export.
         */
        app: z.array(AppRoute).default([]),
      })
      .strict()
      .partial()
      .default({}),
  })
  .strict();

export type SidebarEntry = z.infer<typeof SidebarEntry>;
export type FeatureManifest = z.infer<typeof FeatureManifest>;

/** The JSON Schema editors use. Generated, never hand-written. */
export function featureJsonSchema(): unknown {
  return z.toJSONSchema(FeatureManifest);
}
