import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
// Imported by path, not as @markbase/registry/web: Vite externalizes anything it
// resolves through node_modules when it loads this config, and Node then cannot
// follow the package's extensionless relative imports. A relative path is
// bundled along with them. Build-time only; the registry walks up from cwd.
import { featuresEnvValue } from "../../packages/core/registry/src/web";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The renderer half of this app.
//
// tsup builds the main process — node, CJS, no JSX and no CSS pipeline. Pages
// made of React components and Tailwind classes need a different tool, so they
// get one. The output goes under dist/, which is what electron-builder packages
// and what the markbase:// handler in main.ts serves.
//
// One build, many pages. Rooted at src/renderer with an entry per page, so each
// index.html lands at dist/renderer/<page>/index.html and they SHARE one assets
// directory — React and the component library are compiled once rather than
// once per window.
//
// `base: "./"` is what makes the sharing work: viewer/index.html then asks for
// `../assets/x.js`, which under markbase://app/viewer/index.html resolves to
// markbase://app/assets/x.js, which the handler maps to dist/renderer/assets.
// (The dashboard page is served at routed paths too; the handler folds any
// `/assets/<file>` back to the one directory.)
export default defineConfig({
  root: here("./src/renderer"),
  base: "./",
  plugins: [react(), tailwindcss()],
  // @markbase/protocol/browser reads the Supabase project from the names the
  // website's build gives it. These pages have no Next build, and the pair
  // cannot be baked in either: this app is built once and the machine it runs
  // on may have been pointed at a self-hosted instance (SELF-HOSTING.md). So
  // the reads become the two globals the preload exposes from argv, which main
  // fills from the same resolution it uses itself (env, saved instance, the
  // defaults in supabase-defaults.ts). A define value must be an identifier
  // path or a literal — hence globals rather than an expression with a
  // fallback; the preload always sets them, to the defaults if nothing else.
  define: {
    "process.env.NEXT_PUBLIC_SUPABASE_URL": "globalThis.__MARKBASE_SUPABASE_URL__",
    "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "globalThis.__MARKBASE_SUPABASE_KEY__",
    // The shipped features and their sidebar entries, read from the manifests
    // at build time exactly as the website's next.config does, so the desktop's
    // main sidebar lists what the website's lists. Read through
    // @markbase/registry/runtime; the packages/ tree is not in the bundle.
    "process.env.MARKBASE_FEATURES_JSON": JSON.stringify(featuresEnvValue()),
  },
  build: {
    outDir: here("./dist/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: here("./src/renderer/dashboard/index.html"),
        viewer: here("./src/renderer/viewer/index.html"),
      },
    },
  },
});
