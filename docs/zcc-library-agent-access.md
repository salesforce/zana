# Agent-accessible project library (`.zcc/library`)

Lets a ZCC agent read, write, edit, and delete durable documents — findings,
decisions, thoughts — in **its own project's** `.zcc/library`, and makes the
agent aware the place exists. Designed by a `/zana` council (2026-06-20).

## Council verdict: APPROVE WITH CONDITIONS

Roster: architect, security-reviewer, api-designer → judge synthesis.
Tally: 2 APPROVE + 1 CHANGES (security). The CHANGES was treated as binding
conditions *within* the approved direction, not a rejection.

- **CONSENSUS** — reuse the existing `LibraryStore`; expose it via project-scoped
  MCP tools that close over `projectId`/`sessionId` from the URL route (the
  `inbox_push` pattern). Never let agents hand-edit `index.json`. Address docs by
  human-meaningful `relPath`, not opaque id. Add one terse guidance block.
- **MAJORITY** — `library_write` is an **upsert** by relPath (fixes that the old
  `update()` couldn't revise a doc body). A `library_read` tool is essential.
- **DISSENT (security, all binding):** realpath-confine every relPath; reject
  `index.json` + dot-prefixed segments; never accept `scope`/`source` from the
  agent (host locks scope=project, stamps `source.kind='agent'`); refuse to
  mutate user/inbox/schedule-authored docs.
- **Scope conflict resolved** to the safety position: **project-locked, no global
  opt-in** for agent tools (architect + security over api-designer's `'global'`).

## What shipped (tickets #2, #3)

- **`src/main/library-store.ts`** — agent-facing, project-locked methods on
  `LibraryStore` (+ `ILibraryStore` + the in-memory test store):
  `agentList` / `agentRead` / `agentWrite` (upsert) / `agentRemove` (hard-deletes
  file+manifest — agents own what they create). Guards: `validateAgentRelPath`
  (rejects `..`, absolute, dot-segments, `index.json`) + realpath `confine()`
  (now exported from `src/main/fs.ts`) against the resolved library dir; host-set
  `source:{kind:'agent',sessionId,projectId}`; agent-only mutation gate.
- **`src/main/library-mcp-tools.ts`** (new) — `library_write` / `library_read` /
  `library_list` / `library_remove`, house style, identity from the route.
- **`src/main/mcp-server.ts`** — `libraryAgentApi` dep on `McpServerOptions`,
  threaded through `buildProjectMcpServer`, registered **session-scoped only**
  (a write needs a sessionId to stamp).
- **`src/main/index.ts`** — wires `libraryAgentApi` to `libraryStore` in the live
  `startMcpServer` call. Always on (no flag) — project-confined, non-destructive
  by default.
- **`src/main/pty.ts`** — `PROJECT_LIBRARY_GUIDANCE` block, appended to every
  local claude tab (interactive + scheduled), alongside the existing INBOX /
  MESH / PROJECT_AWARENESS blocks. Remote (SSH) tabs skip it (they skip MCP).
- **Tests** — `src/main/__tests__/library-store.test.ts` agent-surface suite:
  host-stamped source, upsert overwrite + metadata-only, reserved-name reject,
  **symlinked-subdir confinement**, user-doc protection, hard-delete, scope lock.
  All 936 main+shared tests green; `tsc` clean.

## Git-trackability (ticket #4 — shipped 2026-06-22)

Project library docs are now committable so they travel with the repo, while the
volatile `.zcc/` state stays ignored. Implementation (all inside `LibraryStore`
— no second write path):

- **`.gitignore`** — flipped `.zcc/` to `.zcc/*` (ignore CONTENTS so git still
  descends) + `!.zcc/library/` re-include, then re-ignored `.zcc/library/index.json`
  and `.zcc/library/*.tmp-*`. Verified with `git check-ignore`: docs committable,
  manifest + other `.zcc/` subdirs (personas/teams/schedules/inbox/mcp) ignored.
- **Front-matter round-trip** — `agentWrite` prepends a tiny dependency-free YAML
  header (`id/title/summary/tags/source/createdAt`, string values JSON-encoded so
  colons/quotes can't break it) to markdown docs; `agentRead` strips it so the
  agent gets back exactly the body it wrote. Non-md content is written verbatim.
  Metadata-only edits rewrite the header, keep the body.
- **`reconcile()`** — now walks subdirs (agents are steered to `findings/`,
  `decisions/`, `thoughts/` prefixes; skips dotdirs) and, for a markdown file
  missing from the manifest, recovers `id/title/tags/...` from its front-matter.
  Result: a **freshly-cloned project with no committed `index.json` rebuilds the
  manifest losslessly** (id preserved, not degraded to an untracked `id=''` row).
  Malformed front-matter falls back to untracked — never throws.
- Tests: front-matter round-trip, verbatim non-md, metadata-only edit, fresh-clone
  lossless rebuild, malformed-header fallback. 951 main+shared green.

Hard constraint honored: git-trackability is a property of *where/how the store
writes* — every path still goes through `LibraryStore`.

## Rollback

Remove the `libraryAgentApi` wiring in `index.ts` → the `library_*` tools stop
registering (agents simply don't see them); drop `PROJECT_LIBRARY_GUIDANCE` from
the two append strings in `pty.ts`. The `LibraryStore` agent methods are
additive and inert without the wiring.
