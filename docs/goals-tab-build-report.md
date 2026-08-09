# Goals tab + agent goal-authoring — build report

**Date:** 2026-06-28
**Branch:** 0.8.7

## What you asked for

1. Build a **Goals tab** so you can see all the goals on a project.
2. Answer: **can Claude Code create our goals?** → Yes, two ways now (below).
3. Answer: **do we have skills?** → The `zcc-center` skill now teaches goal authoring.

## What shipped

### 1. Per-project Goals tab (kept the global tab too)

- `'goals'` added to the per-project `WorkspaceMode`; persisted across restarts.
- **`GoalsPanel`** refactored to a dual-shape component: an optional `projectId`
  prop puts it in an embedded, project-scoped mode (filters to that project,
  hides the per-row project label, locks the project picker in the create modal).
  Global behaviour is unchanged when the prop is absent — no component
  duplication.
- New **`ProjectGoalsView`** wrapper + lazy-loaded into **`Workspace`** (segmented
  control + topbar label, `Target` icon).
- **`ProjectScopedNav`** gets a Goals rail entry with a live **active-goal badge**
  + running dot, backed by the new `useProjectActiveGoalCount(projectId)` hook.

### 2. Can Claude Code create goals? — Yes

- **`goal_create` / `goal_list` MCP tools** (server `zcc-inbox`), mirroring the
  library-tools trust pattern: the `projectId` and `scope` are **forced from the
  MCP URL route**, never read from agent input — an agent can only create/list
  goals in *its own* project (Rules 1 & 2). `goal_list` returns a compact
  projection (no verbose iteration history).
- Wired through `mcp-server.ts` (gated on a `goalAgentApi` dep) and `index.ts`
  (a project-locked slice of the `GoalManager`).
- Agents can *also* still hand-write the goal JSON into `.zcc/goals/` directly —
  the tool is just the safer, validated path.

### 3. Do we have skills? — extended `zcc-center`

`~/.claude/skills/zcc-center/SKILL.md` now documents the goal JSON shape, the
`~/.zcc/goals/` (global) and `<project>/.zcc/goals/` (per-project) directories,
the lifecycle/terminal-status rules, and the `goal_create`/`goal_list` MCP tools
as the preferred path for in-project agents.

## Verification

- `npx tsc --noEmit` — clean.
- Goal suites (`goal-manager`, `goal-store`, `goal-mcp-tools`) — **50/50 pass**.
- `mcp-server` + Rule-6 literal guard — **29/29 pass** (no regression from the
  new wiring or renderer changes).

> Not done: a live end-to-end goal run (would spend real tokens). The full
> wiring is verified by tests + typecheck.
