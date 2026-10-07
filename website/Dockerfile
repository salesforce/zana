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
# Lockfiles from Salesforce machines pin `resolved` to Nexus; rewrite those
# tarball URLs so npm actually hits registry.npmjs.org (the registry env
# alone does not override lockfile `resolved` fields).
RUN if [ -f package-lock.json ]; then \
      sed -i 's#https://nexus-proxy.repo.local.sfdc.net/nexus/content/groups/npm-all/#https://registry.npmjs.org/#g' package-lock.json; \
    fi
RUN npm install --no-audit --no-fund

# NEXT_PUBLIC_* are inlined at build time, so pass them as build args when the
# feed URLs exist (see heroku.yml / docker build --build-arg). PUBLIC_BASE_URL
# is also needed at build time for metadataBase / canonical URLs.
ARG NEXT_PUBLIC_REGISTRY_URL=""
ARG NEXT_PUBLIC_UPDATE_FEED_URL=""
ARG NEXT_PUBLIC_APP_VERSION="2.3.4"
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID=""
ARG PUBLIC_BASE_URL="http://localhost:4321"
ENV NEXT_PUBLIC_REGISTRY_URL=$NEXT_PUBLIC_REGISTRY_URL \
    NEXT_PUBLIC_UPDATE_FEED_URL=$NEXT_PUBLIC_UPDATE_FEED_URL \
    NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION \
    NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID \
    PUBLIC_BASE_URL=$PUBLIC_BASE_URL \
    NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4321

# Heroku Essential Postgres uses AWS RDS certificates. Pin the vendor bundle
# so production can use PGSSLMODE=verify-full without disabling TLS validation.
# Refresh this checksum deliberately when AWS rotates the published bundle.
ADD --checksum=sha256:e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3 \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/aws-rds-global-bundle.pem
RUN chmod 0644 /app/certs/aws-rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/aws-rds-global-bundle.pem

# Next's standalone output is self-contained (its own pruned node_modules), but
# static assets and public/ are NOT copied into it automatically — copy them
# alongside per Next's standalone docs. The pairing front door is vanilla Node
# (ws is explicitly copied because Next's tracing cannot see the front door).
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/relay ./relay
COPY --from=build /app/connect ./connect
COPY --from=build /app/slack ./slack
COPY --from=build /app/drizzle/pg ./drizzle/pg
COPY --from=build /app/node_modules/ws ./node_modules/ws
# Next bundles Drizzle into its route chunks; the standalone Connect process
# imports its migrator directly and therefore needs the package as well.
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

# Next writes its runtime fetch/prerender cache as the non-root app user.
RUN mkdir -p .next/cache && chown -R node:node .next/cache

# Run as the built-in non-root user.
USER node

# Heroku injects $PORT; the front door binds it and proxies marketing traffic
# to Next on 127.0.0.1:4322.
EXPOSE 4321
CMD ["node", "relay/front-door.mjs"]
