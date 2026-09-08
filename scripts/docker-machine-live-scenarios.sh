#!/usr/bin/env bash
# Deep Docker remote-machine scenarios:
#   1. pairing-session E2E (/t/<session> install.sh + enroll + zcc-join)
#   2. isolated loopback join (install.sh → connected host)
#   3. live join against pnpm dev on :8780 (directory RPC, key forwarding,
#      optional OpenCode turn when OPENAI_API_KEY is set)
#
# Never prints secret values.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SERVER_PORT=${ZCC_SERVER_PORT:-8780}
LIVE_OPENCODE=${ZCC_DOCKER_LIVE_OPENCODE:-auto}
SCENARIOS=${ZCC_DOCKER_SCENARIOS:-all}
passed=0
failed=0

pass() {
  passed=$((passed + 1))
  printf 'PASS  %s\n' "$1"
}

fail() {
  failed=$((failed + 1))
  printf 'FAIL  %s\n' "$1" >&2
  if [[ -n "${2:-}" ]]; then
    printf '%s\n' "$2" >&2
  fi
}

load_openai_key() {
  if [[ -z "${OPENAI_API_KEY:-}" && -f "$ROOT/.env" ]]; then
    OPENAI_API_KEY=$(KEY=OPENAI_API_KEY node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const name = process.env.KEY;
      const text = readFileSync(process.argv[1], "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1 || trimmed.slice(0, eq).trim() !== name) continue;
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith("\"") && value.endsWith("\""))
          || (value.startsWith("'\''") && value.endsWith("'\''"))
        ) {
          value = value.slice(1, -1);
        }
        process.stdout.write(value);
        break;
      }
    ' "$ROOT/.env")
  fi
  export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
  if [[ -z "${CURSOR_API_KEY:-}" && -f "$ROOT/.env" ]]; then
    CURSOR_API_KEY=$(KEY=CURSOR_API_KEY node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const name = process.env.KEY;
      const text = readFileSync(process.argv[1], "utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 1 || trimmed.slice(0, eq).trim() !== name) continue;
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith("\"") && value.endsWith("\""))
          || (value.startsWith("'\''") && value.endsWith("'\''"))
        ) {
          value = value.slice(1, -1);
        }
        process.stdout.write(value);
        break;
      }
    ' "$ROOT/.env")
  fi
  export CURSOR_API_KEY="${CURSOR_API_KEY:-}"
}

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is not available. Start Docker Desktop, then retry.\n' >&2
  exit 1
fi

cd "$ROOT"
load_openai_key
if [[ -n "$OPENAI_API_KEY" ]]; then
  printf 'OPENAI_API_KEY is set (%d chars). Live OpenCode turns will run.\n' "${#OPENAI_API_KEY}"
  export ZCC_INSTALL_OPENCODE=${ZCC_INSTALL_OPENCODE:-1}
else
  printf 'OPENAI_API_KEY is unset. Live OpenCode turns will be skipped.\n'
  export ZCC_INSTALL_OPENCODE=${ZCC_INSTALL_OPENCODE:-0}
fi

if [[ "$SCENARIOS" == all || "$SCENARIOS" == pairing ]]; then
  printf '\n== 1. pairing session E2E (/t/<session>) ==\n'
  if ZCC_DOCKER_E2E=1 pnpm exec vitest run docker/remote-machine/pairing-session.e2e.test.ts --reporter=dot; then
    pass 'pairing session install.sh + enroll + zcc-join'
  else
    fail 'pairing session E2E'
  fi
fi

if [[ "$SCENARIOS" == all || "$SCENARIOS" == isolated ]]; then
  printf '\n== 2. isolated loopback join ==\n'
  if bash "$ROOT/scripts/docker-machine-join-test.sh"; then
    pass 'isolated docker join reports connected'
  else
    fail 'isolated docker join'
  fi
fi

if [[ "$SCENARIOS" != all && "$SCENARIOS" != live ]]; then
  printf '\n%d passed, %d failed\n' "$passed" "$failed"
  if [[ "$failed" -gt 0 ]]; then
    exit 1
  fi
  exit 0
fi

printf '\n== 3. live join against product HTTP :%s ==\n' "$SERVER_PORT"
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/zcc-docker-live-XXXXXX")
cleanup_work() { rm -rf "$WORKDIR"; }
trap cleanup_work EXIT

if ! curl -sf "http://127.0.0.1:${SERVER_PORT}/api/v1/health" >/dev/null; then
  printf 'skip live join — no product server on :%s (start pnpm dev / pnpm dev:prod)\n' "$SERVER_PORT"
elif ! bash "$ROOT/scripts/docker-remote-machine.sh" join --local --server-port "$SERVER_PORT"; then
  fail 'live --local enroll'
else
  pass 'live --local enroll connected'
  curl -sf "http://127.0.0.1:${SERVER_PORT}/api/v1/hosts" >"$WORKDIR/hosts.json" || true
  host_id=$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const hosts = JSON.parse(readFileSync(process.argv[1], "utf8") || "[]");
    const row = Array.isArray(hosts)
      ? hosts.find((h) => h.name === "zcc-docker" && h.status === "connected")
        ?? hosts.find((h) => h.status === "connected" && !h.isPrimary)
      : null;
    process.stdout.write(row?.id ?? "");
  ' "$WORKDIR/hosts.json")
  if [[ -z "$host_id" ]]; then
    fail 'live hub has no connected zcc-docker row' "$(cat "$WORKDIR/hosts.json")"
  else
    pass "hub lists connected host $host_id"
    dir=$(curl -sS -o "$WORKDIR/dir.json" -w '%{http_code}' \
      "http://127.0.0.1:${SERVER_PORT}/api/v1/hosts/${host_id}/directory?path=/home/zcc/workspace")
    if [[ "$dir" == 200 ]] && node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const body = JSON.parse(readFileSync(process.argv[1], "utf8"));
      const names = (body.entries ?? []).map((e) => e.name);
      if (!names.includes("sample-app") && !names.includes("README.txt")) {
        throw new Error("workspace listing missing sample files: " + names.join(","));
      }
    ' "$WORKDIR/dir.json"; then
      pass 'directory RPC lists /home/zcc/workspace'
    else
      fail 'directory RPC' "$(cat "$WORKDIR/dir.json" 2>/dev/null || true)"
    fi

    key_state=$(docker exec zcc-docker sh -c 'if [ -n "${OPENAI_API_KEY:-}" ]; then echo present; else echo absent; fi' 2>/dev/null || echo missing-container)
    if [[ -n "$OPENAI_API_KEY" ]]; then
      if [[ "$key_state" == present ]]; then
        pass 'OPENAI_API_KEY reached the container (value not printed)'
      else
        fail "OPENAI_API_KEY did not reach the container ($key_state)"
      fi
    else
      pass "no OpenAI key to forward (container reports $key_state)"
    fi

    oc_bin=$(docker exec zcc-docker sh -c 'command -v opencode || true' 2>/dev/null || true)
    codex_bin=$(docker exec zcc-docker sh -c 'command -v codex || true' 2>/dev/null || true)
    codex_acp_bin=$(docker exec zcc-docker sh -c 'command -v codex-acp || true' 2>/dev/null || true)
    pi_bin=$(docker exec zcc-docker sh -c 'command -v pi || true' 2>/dev/null || true)
    cursor_bin=$(docker exec zcc-docker sh -c 'command -v cursor-agent || true' 2>/dev/null || true)
    [[ -n "$oc_bin" ]] && pass "opencode is on PATH ($oc_bin)" || pass 'opencode is not installed (set ZCC_INSTALL_OPENCODE=1)'
    [[ -n "$codex_bin" ]] && pass "codex is on PATH ($codex_bin)" || pass 'codex is not installed (set ZCC_INSTALL_CODEX=1)'
    [[ -n "$codex_acp_bin" ]] && pass "codex-acp is on PATH ($codex_acp_bin)" || pass 'codex-acp is not installed (set ZCC_INSTALL_CODEX=1)'
    [[ -n "$pi_bin" ]] && pass "pi is on PATH ($pi_bin)" || pass 'pi is not installed (set ZCC_INSTALL_PI=1)'
    [[ -n "$cursor_bin" ]] && pass "cursor-agent is on PATH ($cursor_bin)" || pass 'cursor-agent is not installed (set ZCC_INSTALL_CURSOR=1)'

    curl -sS -X POST "http://127.0.0.1:${SERVER_PORT}/api/v1/projects" \
      -H 'content-type: application/json' \
      -d "$(HOST_ID="$host_id" node --input-type=module -e '
        process.stdout.write(JSON.stringify({
          path: "/home/zcc/workspace",
          hostId: process.env.HOST_ID
        }));
      ')" >"$WORKDIR/project.json"
    project_id=$(node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const body = JSON.parse(readFileSync(process.argv[1], "utf8"));
      process.stdout.write(body.project?.id ?? "");
    ' "$WORKDIR/project.json")
    if [[ -z "$project_id" ]]; then
      fail 'create project on docker host' "$(cat "$WORKDIR/project.json")"
    else
      pass "project $project_id bound to docker host"
      run_live_turn() {
        local label=$1 provider=$2 extra=()
        shift 2
        extra=("$@")
        if node "$ROOT/scripts/docker-machine-live-turn.mjs" \
          --server "http://127.0.0.1:${SERVER_PORT}" \
          --host-id "$host_id" --project-id "$project_id" \
          --provider "$provider" --permission-mode full "${extra[@]}"; then
          pass "$label live turn returned pong"
        else
          fail "$label live turn"
        fi
      }
      if [[ -n "$OPENAI_API_KEY" && -n "$oc_bin" ]]; then
        run_live_turn OpenCode opencode
      else
        pass 'skip OpenCode live turn (no key and/or no opencode binary)'
      fi
      if [[ -n "$OPENAI_API_KEY" && -n "$codex_acp_bin" ]]; then
        run_live_turn Codex codex
      else
        pass 'skip Codex live turn (no key and/or no codex-acp binary)'
      fi
      if [[ -n "$OPENAI_API_KEY" ]]; then
        run_live_turn Pi pi --model openai/gpt-4o-mini
      else
        pass 'skip Pi live turn (no OpenAI key)'
      fi
      if [[ -n "${CURSOR_API_KEY:-}" && -n "$cursor_bin" ]]; then
        run_live_turn Cursor cursor
      else
        pass 'skip Cursor live turn (CURSOR_API_KEY unset and/or no cursor-agent binary)'
      fi
    fi
  fi
fi

printf '\n%d passed, %d failed\n' "$passed" "$failed"
if [[ "$failed" -gt 0 ]]; then
  exit 1
fi
