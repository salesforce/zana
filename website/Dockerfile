# syntax=docker/dockerfile:1
# Multi-stage build for the Zana Command Center website (Next.js standalone)
# plus the pairing-relay front door. Stage 1 builds `.next/standalone`;
# stage 2 copies Next + website/relay and runs `node relay/front-door.mjs`.
# The front door binds `0.0.0.0:$PORT` (Heroku), Next listens on container
# loopback, and pairing paths never enter Next (`trailingSlash` would 308
# `/install.sh`).

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app

# Salesforce developer machines rewrite lockfile resolved URLs to a corp
# Nexus; the image must fetch from the public registry.
ENV npm_config_registry=https://registry.npmjs.org/
# Install deps. `npm ci` is preferred when the lockfile lists every optional
# platform package; this lockfile is generated on darwin and omits some
# nested esbuild binaries, so `npm install` honors the lock while filling
# those in on the linux build.
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# NEXT_PUBLIC_* are inlined at build time, so pass them as build args when the
# feed URLs exist (see heroku.yml / docker build --build-arg).
ARG NEXT_PUBLIC_REGISTRY_URL=""
ARG NEXT_PUBLIC_UPDATE_FEED_URL=""
ARG NEXT_PUBLIC_APP_VERSION="1.0.10"
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
    PORT=4321

# Next's standalone output is self-contained (its own pruned node_modules), but
# static assets and public/ are NOT copied into it automatically — copy them
# alongside per Next's standalone docs. The pairing front door is vanilla Node
# (no extra runtime npm deps).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/relay ./relay

# Run as the built-in non-root user.
USER node

# Heroku injects $PORT; the front door binds it and proxies marketing traffic
# to Next on 127.0.0.1:4322.
EXPOSE 4321
CMD ["node", "relay/front-door.mjs"]
