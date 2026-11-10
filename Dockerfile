# The Markbase server as one container: the web app, its API, and nothing else.
# It talks to a Supabase project you own (SELF-HOSTING.md). Build it from the
# repo root:
#
#   docker compose up --build        # reads .env (copy .env.example)
#
# or by hand:
#
#   docker build -t markbase-web .
#
# Nothing about the Supabase project goes into the image. Its public half
# (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) is read from
# the container's environment when it starts, like the secret key and
# everything else, and the server hands it to the browser in every page
# (apps/web/src/app/layout.tsx; GET /api/v1/instance says the same). So one
# image serves any instance: build once, start it per team with its own .env.
#
# For that to hold, the two names must NOT be set while `next build` runs here:
# Next substitutes any NEXT_PUBLIC_ name that is set at build time into the
# bundles, and the pages of such an image would carry the build's project after
# all. Their absence is also what tells the build to render every page at
# request time (MARKBASE_INSTANCE_AT_RUNTIME, next.config.ts).

# ---- build --------------------------------------------------------------------
# Debian rather than Alpine: the lockfile pins the glibc builds of the native
# CSS tooling (lightningcss, Tailwind's oxide), which a musl image cannot load.
FROM node:22-bookworm-slim AS build
WORKDIR /repo

# The whole monorepo: the web app compiles the workspace packages in from
# source, and the lockfile is one tree. .dockerignore keeps node_modules, build
# output and release artifacts out of the context.
COPY . .

# --ignore-scripts: the install is for the web build alone. The other
# workspaces' install scripts (Electron's binary download, node-pty's compile)
# have no business in this image, and nothing the web build needs runs one.
RUN npm ci --ignore-scripts

# The feature set IS compiled in (next.config.ts inlines the manifests), so it
# stays a build arg; see MARKBASE_FEATURES in .env.example.
ARG MARKBASE_FEATURES
ENV MARKBASE_FEATURES=$MARKBASE_FEATURES \
    MARKBASE_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1

# No project in the build (see the top of this file): the two NEXT_PUBLIC_
# names are deliberately not ARGs, so nothing outside can set them here.
RUN npm run build --workspace @markbase/web

# ---- run ----------------------------------------------------------------------
FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# The traced server: only the files the app's routes reach, laid out as the
# monorepo was (apps/web/server.js, the packages it imports, a pruned
# node_modules). Static assets and public/ are not traced and are copied in
# beside it, where server.js serves them.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

# The API's public discovery manifest answers without credentials.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# 64 KB of request headers instead of Node's 16 KB. A browser sends every cookie
# it holds for the hostname, whatever the port, so an instance tried out at
# localhost:<port> on a developer machine gets other apps' sessions too, and
# past 16 KB Node answers 431 before the app sees the request (SELF-HOSTING.md,
# Troubleshooting).
#
# The Supabase project comes from the environment at this point and nowhere
# else, so a container started without one is refused here, in one line in the
# logs, rather than serving pages that cannot sign in.
CMD ["sh", "-c", "test -n \"$NEXT_PUBLIC_SUPABASE_URL\" && test -n \"$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\" || { echo 'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set in the environment (.env): the image reads them when it starts' >&2; exit 1; }; exec node --max-http-header-size=65536 apps/web/server.js"]
