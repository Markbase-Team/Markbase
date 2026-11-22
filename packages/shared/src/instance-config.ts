// Which Supabase project the page in front of a person runs on.
//
// The browser needs the project's public pair (URL + publishable key) to sign
// in and to join a document's live channel. Where does a page get it?
//
//  - The hosted app and the dev server have it in the build: `NEXT_PUBLIC_…`
//    reads are substituted at `next build` time, in the browser bundle and in
//    the server bundle alike.
//  - A self-hosted image (Dockerfile) is built ONCE with no project at all, so
//    one image can be started for any team's instance (SELF-HOSTING.md). There
//    the server reads the pair from its environment at request time and hands
//    it to the browser in every page: a script in the root layout sets
//    `globalThis.__MARKBASE_INSTANCE__` before any application code runs.
//    GET /api/v1/instance says the same thing, for clients that are not a page.
//  - The desktop app's windows have neither; its vite build turns the
//    `NEXT_PUBLIC_…` reads into globals the preload fills (apps/app).
//
// `instancePublicConfig()` is the one place that resolves the three, and
// everything in the browser that needs the pair goes through it. The runtime
// value wins when it is there: that is the one that says which project THIS
// server runs on; a build-time value can only say which project the build was
// made for, which is the same project only where the build is the deployment.

// Typed locally rather than pulled in from @types/node: this module is reachable
// from @markbase/ui, which correctly declares `"types": []` — a browser package
// with no business claiming node globals.
//
// The two reads below must stay written as the literal `process.env.NEXT_PUBLIC_…`:
// that exact text is what the bundlers substitute (Next at build time, the
// desktop's vite define). A dynamic lookup would be left as is and undefined.
declare const process: { env: Record<string, string | undefined> };

/** The public half of a Supabase project: enough to sign in and to subscribe, nothing more. */
export interface InstancePublicConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

/** The global the server-rendered page sets. One name, shared by the writer and the reader. */
export const INSTANCE_GLOBAL = "__MARKBASE_INSTANCE__";

/** Whatever is at the global, before it has been checked. */
interface InstanceGlobalWire {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
}

function readGlobal(): InstancePublicConfig | null {
  const holder = globalThis as { [INSTANCE_GLOBAL]?: InstanceGlobalWire };
  const injected = holder[INSTANCE_GLOBAL];
  if (!injected) return null;
  return complete(injected.supabaseUrl, injected.supabasePublishableKey);
}

function readBuild(): InstancePublicConfig | null {
  return complete(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

/** Both halves, or nothing: a URL without a key signs nobody in. */
function complete(
  url: string | undefined,
  key: string | undefined
): InstancePublicConfig | null {
  if (!url || !key) return null;
  return { supabaseUrl: url, supabasePublishableKey: key };
}

/**
 * The project this page runs on, or null when nothing says: the server-injected
 * value first, the build's second.
 */
export function findInstancePublicConfig(): InstancePublicConfig | null {
  return readGlobal() ?? readBuild();
}

/** The project this page runs on. Throws when nothing says, naming both places it looked. */
export function instancePublicConfig(): InstancePublicConfig {
  const config = findInstancePublicConfig();
  if (!config) {
    throw new Error(
      `No Supabase project for this page: neither ${INSTANCE_GLOBAL} (set by the server at ` +
        "request time) nor NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY " +
        "(set at build time) is present."
    );
  }
  return config;
}

/**
 * The inline script a server renders into a page so that `instancePublicConfig()`
 * finds the project at run time. JSON, with `<` escaped so the values can never
 * close the script element they sit in, whatever an environment variable holds.
 */
export function instanceConfigScript(config: InstancePublicConfig): string {
  const json = JSON.stringify({
    supabaseUrl: config.supabaseUrl,
    supabasePublishableKey: config.supabasePublishableKey,
  }).replace(/</g, "\\u003c");
  return `globalThis.${INSTANCE_GLOBAL}=${json};`;
}
