#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
IMAGE=${ZCC_E2E_DOCKER_IMAGE:-zana-e2e:playwright-1.62.1-node22}
PLATFORM=${ZCC_E2E_DOCKER_PLATFORM:-linux/amd64}
CONTAINER="zana-e2e-${RANDOM}-$$"

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is required. Install and start Docker Desktop, then retry.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is not available. Start Docker Desktop, then retry.\n' >&2
  exit 1
fi

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker build \
  --platform "$PLATFORM" \
  --tag "$IMAGE" \
  --file "$ROOT/e2e/docker/Dockerfile" \
  "$ROOT/e2e/docker"

docker create \
  --name "$CONTAINER" \
  --platform "$PLATFORM" \
  --init \
  --shm-size 2g \
  --env CI=1 \
  --env NODE_OPTIONS=--max-old-space-size=6144 \
  --workdir /workspace \
  "$IMAGE" \
  sleep infinity \
  >/dev/null

# Copying instead of bind-mounting keeps Linux native modules and root-owned
# build artifacts out of the macOS checkout. Exclusions prevent stale host
# builds, dependencies, VCS data, and local credentials entering the container.
docker start "$CONTAINER" >/dev/null
tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='*/node_modules' \
  --exclude='out' \
  --exclude='dist' \
  --exclude='*/dist' \
  --exclude='test-results' \
  --exclude='playwright-report' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='.zcc' \
  --exclude='.claude' \
  -C "$ROOT" -cf - . | docker exec -i "$CONTAINER" tar -C /workspace -xf -
docker exec "$CONTAINER" bash -lc '
  for attempt in 1 2 3; do
    npm ci && break
    if [ "$attempt" -eq 3 ]; then exit 1; fi
    rm -rf node_modules
    sleep "$((attempt * 5))"
  done
  npx playwright install-deps chromium
  npm run build
  xvfb-run -a npm run test:e2e:only -- "$@"
' bash "$@"
