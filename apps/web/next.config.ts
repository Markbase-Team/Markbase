import type { NextConfig } from "next";
import { join } from "node:path";
import {
  transpilePackages,
  featuresEnvValue,
  disabledRoutesEnvValue,
} from "@markbase/registry/web";

// The app and the Skills API are one deployment served on two hostnames:
//  - markbase.so → the ticketing app (board, diary, admin, …)
//  - skills.markbase.so → the public Skills API landing + /api/v1 endpoints
// Host-based rewrites/redirects keep them serving distinct content. Config
// redirects run before middleware, so the admin auth flow is untouched.
//
// A self-hosted instance (SELF-HOSTING.md) has one hostname of its own and no
// skills host, so both are read from the environment. The redirects below only
// fire on a request whose Host header is the skills host, so an instance that
// never sets MARKBASE_SKILLS_HOST is simply never redirected.
const APP_HOST = process.env.MARKBASE_APP_HOST ?? "markbase.so";
const SKILLS_HOST = process.env.MARKBASE_SKILLS_HOST ?? "skills.markbase.so";
const onSkillsHost = [{ type: "host" as const, value: SKILLS_HOST }];

// The Docker image (Dockerfile at the repo root) runs the traced standalone
// server rather than `next start`, so it ships without node_modules. Opt-in:
// Vercel builds and serves this app its own way and is left exactly as it was.
// The tracing root is the monorepo root, or the workspace packages this app
// transpiles would fall outside the trace and be missing from the image.
const standalone = process.env.MARKBASE_STANDALONE === "1";
// This file is loaded as CommonJS or as a module depending on the Next
// release; `__dirname` exists only in the first, and the workspace runs the
// build from apps/web, so the cwd names the same directory in the second.
const webDir = typeof __dirname === "string" ? __dirname : process.cwd();

const nextConfig: NextConfig = {
  ...(standalone
    ? { output: "standalone", outputFileTracingRoot: join(webDir, "../..") }
    : {}),
  // Don't advertise the framework in an `X-Powered-By` header.
  poweredByHeader: false,
  // Compile the shared workspace packages (TypeScript source).
  //
  // Generated from the feature manifests plus the kernel list, rather than
  // maintained here: a hand-kept copy goes stale the first time a feature is
  // added, and `MARKBASE_FEATURES` has to be able to drop one. See
  // packages/features.
  transpilePackages: transpilePackages(),

  // The feature set, inlined at build time. The manifests live in the
  // monorepo's packages/ tree, which is NOT deployed — a serverless function
  // has no such directory to read — so the build resolves them once and
  // substitutes the result here. Read it through @markbase/registry/runtime.
  env: {
    MARKBASE_FEATURES_JSON: featuresEnvValue(),
    MARKBASE_DISABLED_ROUTES_JSON: disabledRoutesEnvValue(),
    // Whether this build carries a Supabase project. Without one (the
    // self-hosted image is built that way, so one image serves any instance)
    // the server reads the project from its environment at request time and
    // the root layout renders every page then, never at build time.
    MARKBASE_INSTANCE_AT_RUNTIME: process.env.NEXT_PUBLIC_SUPABASE_URL ? "" : "1",
  },
  // Playwright (loaded lazily by the browser agent) is a native Node package —
  // keep it external so it's required at runtime rather than bundled.
  serverExternalPackages: ["playwright", "playwright-core"],
  // Ensure doc markdown files are bundled for the docs routes on Vercel.
  outputFileTracingIncludes: {
    "/dashboard/docs/**": ["./src/docs/**/*"],
  },

  async headers() {
    // Baseline security headers on every response. The platform only sets HSTS
    // by default; add the rest (and strengthen HSTS with includeSubDomains +
    // preload). No resource-restricting CSP here so we don't break the app,
    // fonts, images, or analytics — just clickjacking/sniffing/referrer/policy.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },

  async rewrites() {
    // /blog/<slug>.md is the post as markdown (app/blog/[slug]/markdown).
    return [{ source: "/blog/:slug.md", destination: "/blog/:slug/markdown" }];
  },

  async redirects() {
    // The root renders the Skills landing per-host (see app/page.tsx). The
    // app's own pages don't belong on the skills host → send them to the app
    // host so the two domains never serve the same thing.
    return [
      {
        source: "/dashboard/:path*",
        has: onSkillsHost,
        destination: `https://${APP_HOST}/dashboard/:path*`,
        permanent: false,
      },
      {
        source: "/projects/:path*",
        has: onSkillsHost,
        destination: `https://${APP_HOST}/projects/:path*`,
        permanent: false,
      },
      {
        source: "/progress",
        has: onSkillsHost,
        destination: `https://${APP_HOST}/progress`,
        permanent: false,
      },
      // Login moved to the top-level /login; keep old links working.
      { source: "/admin/login", destination: "/login", permanent: false },
      // The app moved from /admin to /dashboard; keep old links working.
      { source: "/admin/:path*", destination: "/dashboard/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
