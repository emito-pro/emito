# syntax=docker/dockerfile:1.7
# Full-stack image for the integrated Emito **demo** (a trading platform wired to
# the notification engine).
#
# The demo server is run **directly with `tsx`** — `apps/demo/server/index.ts` and
# the `@emito/*` workspace it imports stay as source in the image. That is
# deliberate: the demo is a LOCAL development showcase (size is irrelevant per the
# build decisions), and running the real entry point unbundled keeps it
# byte-identical to `pnpm --filter @emito/demo dev`/`start`.
#
# A single `build` stage performs the full workspace install + every build the
# running server needs:
#   1. `turbo build --filter=@emito/demo` — compiles `@emito/demo`'s `^deps` (the
#      whole `@emito/*` graph) and the demo's own `build` (the trading Vite client →
#      `apps/demo/client/dist`, where `server/index.ts` serves static assets from in
#      production).
#   2. `@emito/demo build` — explicit re-run of the trading client build so the
#      `apps/demo/client/dist` output is present even if turbo's cache shortcut elided
#      the emit on a warm layer.
#
# The image keeps the full workspace `node_modules` (tsx, every workspace dep, the
# Drizzle migrations under `packages/db/drizzle` consumed by the boot migration) so
# the runtime needs no second install.
#
# Build context: repo root (so the workspace lockfile + every package is visible).
#   docker build -t emito-demo -f apps/demo/Dockerfile .

# ─── Build stage ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# pnpm version pinned to match `packageManager` in the root package.json.
RUN npm install -g pnpm@10.23.0

# Copy workspace manifests first so the dependency layer caches across edits that do
# not touch package metadata. `.npmrc` MUST be present at install time: its
# `hoist-pattern` exclusion of `@types/react*` is what keeps the React-18/19 dual
# typings from double-loading and breaking the workspace `tsc` builds (see .npmrc).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY turbo.json tsconfig.base.json biome.json ./
# Root build scripts the workspace packages' `build` steps shell out to
# (`@emito/{types,core,db}` run `node ../../scripts/add-js-extensions.mjs dist` to
# rewrite extensionless ESM specifiers). Copied before the turbo build so the step
# resolves them.
COPY scripts/ ./scripts/

# Per-package manifests so pnpm can resolve the whole workspace graph.
COPY apps/demo/package.json ./apps/demo/
COPY packages/auth-jwt/package.json ./packages/auth-jwt/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/js/package.json ./packages/js/
COPY packages/provider-fcm/package.json ./packages/provider-fcm/
COPY packages/provider-kit/package.json ./packages/provider-kit/
COPY packages/provider-resend/package.json ./packages/provider-resend/
COPY packages/provider-slack/package.json ./packages/provider-slack/
COPY packages/provider-telegram/package.json ./packages/provider-telegram/
COPY packages/provider-twilio/package.json ./packages/provider-twilio/
COPY packages/react/package.json ./packages/react/
COPY packages/react-hooks/package.json ./packages/react-hooks/
COPY packages/react-native/package.json ./packages/react-native/
COPY packages/server/package.json ./packages/server/
COPY packages/templates/package.json ./packages/templates/
COPY packages/types/package.json ./packages/types/

# Install the full workspace deps (frozen lockfile keeps the build reproducible).
RUN pnpm install --frozen-lockfile

# Copy the rest of the source the build + runtime read.
COPY packages/ ./packages/
COPY apps/demo/ ./apps/demo/

# 1) Compile `@emito/demo`'s `^deps` (the whole `@emito/*` graph) and the demo's
#    own `build` (trading Vite client).
RUN pnpm exec turbo run build --filter=@emito/demo

# 2) Ensure the trading client bundle is materialised on disk. `turbo build` above
#    already runs the demo's `build`, but a cache shortcut on a warm layer can skip
#    re-emitting the output; this explicit run guarantees `apps/demo/client/dist`
#    (the server's production static root) exists.
RUN pnpm --filter @emito/demo build

# ─── Runtime ──────────────────────────────────────────────────────────────────
# Same image: the demo runs `tsx server/index.ts` directly against the full
# workspace, so no separate runtime stage / second install is needed.
ENV NODE_ENV=production
# In-container port (mapped to a host port by docker-compose.demo.yml).
ENV PORT=3001
EXPOSE 3001

WORKDIR /app/apps/demo
# `wget` (busybox, present in alpine) backs the compose healthcheck; no extra deps.
CMD ["pnpm", "exec", "tsx", "server/index.ts"]
