#!/usr/bin/env bash
# Production-build the public docs, serve the machines page from a Docker image,
# and assert the Tailscale / install copy is present.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
IMAGE=${ZCC_WEBSITE_TEST_IMAGE:-zana-website-docs-test}
CONTAINER="zana-website-docs-$$"
PORT=${ZCC_WEBSITE_TEST_PORT:-14321}

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is required. Install and start Docker Desktop, then retry.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is not available. Start Docker Desktop, then retry.\n' >&2
  exit 1
fi

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/zcc-website-docs-XXXXXX")
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$STAGE"
}
trap cleanup EXIT INT TERM

cd "$ROOT/website"
node scripts/sync-docs.mjs
npm run build

html_src=.next/server/app/docs/multiple-devices.html
if [[ ! -f "$html_src" ]]; then
  printf 'next build did not emit %s\n' "$html_src" >&2
  exit 1
fi

mkdir -p "$STAGE/docs/multiple-devices"
cp "$html_src" "$STAGE/docs/multiple-devices/index.html"

docker build -t "$IMAGE" -f - "$STAGE" <<'EOF'
FROM nginx:1.27-alpine
COPY docs /usr/share/nginx/html/docs
EXPOSE 80
EOF

docker run -d --name "$CONTAINER" -p "${PORT}:80" "$IMAGE" >/dev/null

deadline=$((SECONDS + 30))
until curl -sf "http://127.0.0.1:${PORT}/docs/multiple-devices/" >/dev/null 2>&1; do
  if [[ $SECONDS -ge $deadline ]]; then
    printf 'website container did not become ready\n' >&2
    docker logs "$CONTAINER" >&2 || true
    exit 1
  fi
  sleep 0.3
done

html=$(curl -sfL "http://127.0.0.1:${PORT}/docs/multiple-devices/")
grep -Fq 'Settings → Machines' <<<"$html"
grep -Fq 'tailscale' <<<"$html"
grep -Fq 'install.sh' <<<"$html"
grep -Fq '.zcc-machines' <<<"$html"
grep -Fq 'SSH remotes' <<<"$html"

printf 'website docker docs ok: /docs/multiple-devices/ served from %s\n' "$IMAGE"
