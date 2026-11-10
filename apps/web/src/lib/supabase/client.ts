// The browser Supabase client lives in @markbase/protocol: the Electron
// renderer needs the same authenticated client, and a package that reaches for
// it cannot import out of apps/web. Re-exported here so the shell's own files
// keep their short local path.
export * from "@markbase/protocol/browser";
