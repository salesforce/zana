# syntax=docker/dockerfile:1
# Multi-stage build for the Zana Command Center website (Next.js standalone).
# Stage 1 builds `.next/standalone` (self-contained Next server + deps);
# stage 2 runs it directly with `node server.js`. Heroku container runtime sets
# $PORT — Next's standalone server binds to it via the PORT env var.
#
# The old zero-dep `server.mjs` (static-export server + IP gate) is retired:
# route handlers need a real server runtime, and the IP gate now lives in
# `middleware.ts` so it applies inside the Next server itself.

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

# Install deps against the lockfile for reproducible builds.
COPY package.json package-lock.json* ./
RUN npm ci

# NEXT_PUBLIC_* are inlined at build time, so pass them as build args when the
# feed URLs exist (see heroku.yml / docker build --build-arg).
ARG NEXT_PUBLIC_REGISTRY_URL=""
ARG NEXT_PUBLIC_UPDATE_FEED_URL=""
ARG NEXT_PUBLIC_APP_VERSION="1.0.9"
ENV NEXT_PUBLIC_REGISTRY_URL=$NEXT_PUBLIC_REGISTRY_URL \
    NEXT_PUBLIC_UPDATE_FEED_URL=$NEXT_PUBLIC_UPDATE_FEED_URL \
    NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION \
    NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=4321

# Next's standalone output is self-contained (its own pruned node_modules), but
# static assets and public/ are NOT copied into it automatically — copy them
# alongside per Next's standalone docs.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Run as the built-in non-root user.
USER node

# Heroku injects $PORT; Next's standalone server.js reads it directly.
EXPOSE 4321
CMD ["node", "server.js"]
