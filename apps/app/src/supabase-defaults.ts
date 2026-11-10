// The publishable (anon) Supabase project the HOSTED app talks to — public by
// design; the CLI bundles the same pair. The main process resolves the project
// it runs against as env var, then the instance saved by `markbase instance`
// (SELF-HOSTING.md), then this; and hands the result to every window's preload
// (main.ts windowArgs), where the renderer bundle reads it at run time in place
// of the NEXT_PUBLIC_* names @markbase/protocol/browser was written against
// (vite.config.mts). Nothing is baked into the renderer any more.
export const SUPABASE_URL_DEFAULT = "https://fdcptocdnybavesfuhwa.supabase.co";
export const SUPABASE_KEY_DEFAULT = "sb_publishable_EBhyugSSKenh_GIv-O0NiQ_zehkgPfd";
