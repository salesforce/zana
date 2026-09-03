#!/usr/bin/env bash
# Production-build the public website, serve the Plugin Guide page from a Docker
# image, and assert the in-app map copy is present.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
IMAGE=${ZCC_WEBSITE_TEST_IMAGE:-zana-website-plugin-guide-test}
CONTAINER="zana-website-guide-$$"
PORT=${ZCC_WEBSITE_TEST_PORT:-14321}

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is required. Install and start Docker Desktop, then retry.\n' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is not available. Start Docker Desktop, then retry.\n' >&2
  exit 1
fi

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/zcc-website-guide-XXXXXX")
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$STAGE"
}
trap cleanup EXIT INT TERM

cd "$ROOT/website"
node scripts/sync-plugin-guide.mjs
npm run build

html_src=.next/server/app/extensions.html
if [[ ! -f "$html_src" ]]; then
  html_src=.next/server/app/extensions/page.js
fi
if [[ ! -f "$html_src" ]]; then
  printf 'next build did not emit the extensions page\n' >&2
  exit 1
fi

mkdir -p "$STAGE/extensions"
if [[ "$html_src" == *.html ]]; then
  cp "$html_src" "$STAGE/extensions/index.html"
else
  # App Router may emit a JS server module; extract a readable HTML fallback
  # by copying the RSC payload is not useful here — require the HTML artifact.
  printf 'next build did not emit %s\n' '.next/server/app/extensions.html' >&2
  exit 1
fi

docker build -t "$IMAGE" -f - "$STAGE" <<'EOF'
FROM nginx:1.27-alpine
COPY extensions /usr/share/nginx/html/extensions
EXPOSE 80
EOF

docker run -d --name "$CONTAINER" -p "${PORT}:80" "$IMAGE" >/dev/null

deadline=$((SECONDS + 30))
until curl -sf "http://127.0.0.1:${PORT}/extensions/" >/dev/null 2>&1; do
  if [[ $SECONDS -ge $deadline ]]; then
    printf 'website container did not become ready\n' >&2
    docker logs "$CONTAINER" >&2 || true
    exit 1
  fi
  sleep 0.3
done

html=$(curl -sfL "http://127.0.0.1:${PORT}/extensions/")
grep -Fq 'Plugin Guide' <<<"$html"
grep -Fq 'Every surface a plugin can own' <<<"$html"
grep -Fq 'plugin-guide' <<<"$html"

printf 'website docker plugin guide ok: /extensions/ served from %s\n' "$IMAGE"
