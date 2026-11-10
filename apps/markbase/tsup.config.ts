import { defineConfig } from "tsup";

// Bundle the CLI into a single executable file. @markbase/protocol is a workspace
// package (not published), so we inline it; @supabase/supabase-js stays an
// external runtime dependency that npm installs alongside this package.
export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  clean: true,
  noExternal: [
    "@markbase/protocol",
    "@markbase/node",
    "@markbase/vault",
    "@markbase/runner",
    "@markbase/docs",
    "@markbase/flows",
  ],
  external: ["@supabase/supabase-js", "@modelcontextprotocol/sdk"],
  banner: { js: "#!/usr/bin/env node" },
  // Inline imported .md files (the skill SKILL.md) as raw text.
  esbuildOptions(options) {
    options.loader = { ...options.loader, ".md": "text" };
  },
});
