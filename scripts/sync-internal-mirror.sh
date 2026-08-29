#!/usr/bin/env bash
# Mirror this checkout onto the Salesforce-internal clone, keeping that clone's
# README.md (the "this is an internal copy" banner). GitHub.com/salesforce/zana
# is the product source; git.soma is the keep-in-sync copy.
#
# Usage (from the repo, with VPN / git.soma credentials):
#   bash scripts/sync-internal-mirror.sh
#
# Env:
#   SOURCE_REF          Commit-ish to copy (default: origin/main, or HEAD)
#   INTERNAL_URL        Default: https://git.soma.salesforce.com/chatbots/zana-command-center.git
#   INTERNAL_REMOTE     Tracking name for refs/remotes/<name>/… (default: legacy)
#   INTERNAL_BRANCH     Branch to update on the internal remote (default: main)
#   SOMA_GIT_TOKEN      Optional PAT; used as https://x-access-token:… for fetch/push
#   DRY_RUN=1           Build the commit but do not push
#   PUSH=0              Same as DRY_RUN for the push step
set -euo pipefail

INTERNAL_URL="${INTERNAL_URL:-https://git.soma.salesforce.com/chatbots/zana-command-center.git}"
INTERNAL_REMOTE="${INTERNAL_REMOTE:-legacy}"
INTERNAL_BRANCH="${INTERNAL_BRANCH:-main}"
DRY_RUN="${DRY_RUN:-0}"
PUSH="${PUSH:-1}"

if [[ -z "${SOURCE_REF:-}" ]]; then
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    SOURCE_REF=origin/main
  else
    SOURCE_REF=HEAD
  fi
fi

git_url() {
  if [[ -n "${SOMA_GIT_TOKEN:-}" ]]; then
    # Token lives only in this function's output; callers must not echo it.
    printf '%s\n' "https://x-access-token:${SOMA_GIT_TOKEN}@git.soma.salesforce.com/chatbots/zana-command-center.git"
    return
  fi
  if git remote get-url "$INTERNAL_REMOTE" >/dev/null 2>&1; then
    git remote get-url "$INTERNAL_REMOTE"
    return
  fi
  printf '%s\n' "$INTERNAL_URL"
}

SOURCE_COMMIT="$(git rev-parse "${SOURCE_REF}^{commit}")"

FETCH_URL="$(git_url)"
# Fetch into a remote-tracking ref without printing the URL (it may contain a token).
git fetch --quiet "$FETCH_URL" "+refs/heads/${INTERNAL_BRANCH}:refs/remotes/${INTERNAL_REMOTE}/${INTERNAL_BRANCH}"

INTERNAL_COMMIT="$(git rev-parse "refs/remotes/${INTERNAL_REMOTE}/${INTERNAL_BRANCH}^{commit}")"

README_LINE="$(git ls-tree "$INTERNAL_COMMIT" README.md || true)"
if [[ -z "$README_LINE" ]]; then
  echo "error: ${INTERNAL_REMOTE}/${INTERNAL_BRANCH} has no README.md to preserve" >&2
  exit 1
fi
README_MODE="$(awk '{ print $1 }' <<<"$README_LINE")"
README_BLOB="$(awk '{ print $3 }' <<<"$README_LINE")"

TMP_INDEX="$(mktemp)"
cleanup() { rm -f "$TMP_INDEX"; }
trap cleanup EXIT

GIT_INDEX_FILE="$TMP_INDEX" git read-tree "$SOURCE_COMMIT"
GIT_INDEX_FILE="$TMP_INDEX" git update-index --cacheinfo "$README_MODE" "$README_BLOB" README.md
NEW_TREE="$(GIT_INDEX_FILE="$TMP_INDEX" git write-tree)"
OLD_TREE="$(git rev-parse "${INTERNAL_COMMIT}^{tree}")"

if [[ "$NEW_TREE" == "$OLD_TREE" ]]; then
  echo "internal ${INTERNAL_BRANCH} already matches ${SOURCE_COMMIT:0:12} (README preserved)"
  exit 0
fi

MSG="$(cat <<EOF
chore: mirror salesforce/zana ${SOURCE_COMMIT:0:12}

Keep the internal README.md; copy every other path from the public tree.
EOF
)"

NEW_COMMIT="$(git commit-tree "$NEW_TREE" -p "$INTERNAL_COMMIT" -m "$MSG")"

if [[ "$DRY_RUN" == "1" || "$PUSH" == "0" ]]; then
  echo "dry-run: would push ${NEW_COMMIT:0:12} → ${INTERNAL_REMOTE}/${INTERNAL_BRANCH}"
  echo "$NEW_COMMIT"
  exit 0
fi

git push --quiet "$FETCH_URL" "${NEW_COMMIT}:refs/heads/${INTERNAL_BRANCH}"
echo "pushed ${NEW_COMMIT:0:12} to ${INTERNAL_BRANCH} (source ${SOURCE_COMMIT:0:12})"
