# apps/server/src/services/inbox — Coupling Notes

Load-bearing invariants for inbox read/write split and AI summary.

## Inbox read/write split (inbox_push vs inbox_search)

Read tool (`inbox-search-mcp-tool.ts`, registered on both route shapes in `mcp-server.ts`).

### Invariants

1. Default scope is route's `projectId` (closed over from MCP URL, never agent free-text — Rule 1). `allProjects: true` is only opt-in cross-project read.

2. Read-only and bounded — scans newest `INBOX_SEARCH_SCAN_CAP = 500`, filters in-process, paginates via `before` (Rule 5).

### Why

Pre-approved alongside `inbox_push` in `pty.ts` because scope is auth-derived and access is bounded.

### Implementation

Agent-facing contract lives in `zcc-inbox` skill (`apps/server/src/plugins/builtin-skills/zcc-inbox/SKILL.md`).

### When changing

Modify scope/pagination → verify auth boundary (Rule 1) and cap (Rule 5) hold.

Update tool contract → keep skill in sync.

## Inbox AI Summary (inbox-summary.ts)

`inbox:summarize` IPC summarizes from main's own inbox store — source of truth.

### Invariants

1. Reads main's own inbox store, never renderer-supplied list (Rule 1).

2. Capped at `INBOX_SUMMARY_MAX_ENTRIES = 60`, runs `builtin:inbox-summary` micro-call, never throws (failures resolve to `{ ok:false, reason }`).

### Why

Renderer can't be trusted to supply entry list (Rule 1 — renderer is untrusted). Bounded read prevents unbounded LLM spend (Rule 5).

### Implementation

Renderer (`useInboxSummary` in `apps/app/src/stores/live.ts`) throttles automatic regeneration (`INBOX_SUMMARY_AUTO_MIN_MS` = 10 min floor) and only refetches when inbox content signature changes. Preserve discipline so view-driven card doesn't turn into per-render LLM spend.

### When changing

Modify read source → verify main store is source, not renderer input.

Touch throttle/refetch logic → verify signature-based cache, floor remains.
