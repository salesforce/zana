# Project Focus Mode — grouped session drill-in

**Status:** Draft plan (not yet implemented)
**Author:** Zana orchestrator (planning session, 2026-06-11)
**Goal:** Double-click a project → the vertical column drills into a focused, status-grouped view of *only that project's* sessions, so the user can concentrate on one project at a time.

---

## 1. What the user asked for

> A user should be able to double click on a project and then it will select that project; in the vertical column, display all the "shell, claude, etc" under it grouped by idle, running, background, etc. This will allow us to be more concentrated.

### Resolved design decisions

| Fork | Decision |
|---|---|
| **Interaction model** | **Drill-in focus mode** — double-click *replaces* the project list in the column with a focused single-project view (with a "← All projects" back affordance). Single-click keeps today's behavior (just selects). |
| **Status buckets** | **Agent-aware** — reuse the live `AgentState`. Buckets in priority order: **Needs you → Running → Done → Idle → Background → Exited**. |

---

## 2. Key finding — most of this already exists

This is **largely a view/interaction change, not new infrastructure.** The data is already there:

| Signal | Where it lives today | Reuse |
|---|---|---|
| Sessions per project | `useData.terminals: Record<projectId, TerminalSession[]>` (`store.ts:543`) | Source list |
| PTY lifecycle | `TerminalSession.status: 'starting'\|'running'\|'exited'` (`types.ts:114`) | → Exited bucket |
| Background flag | `TerminalSession.headless?: boolean` (`types.ts:120`) + `backgroundTerminals()` / `visibleTerminals()` helpers (`store.ts:645,656`) | → Background bucket |
| Live agent state | `useAgentStatus.byId[sessionId]: AgentState` (`store.ts:1543`), values `working\|blocked\|done\|idle\|unknown`, fed by the OSC-title detector in `src/main/agent-status.ts` | → Needs you / Running / Done / Idle buckets |
| Per-project rollup | `useAgentStatus.rollup[projectId]` with `AGENT_STATE_RANK` (`store.ts:1514`) | Project-row status dot |
| Selection | `useUi.selectedProjectId` + `selectProject(id)` (`store.ts:66,334`), persisted via `AppConfig.lastProjectId` | Reuse; add a focus flag |
| Inline session rows | `ListPane.tsx:548–618` already renders a project's tabs inline (flat) | Restructure into groups |
| Grouping idiom | Schedule groups (`ListPane.tsx` scheduler section) — collapsible `SectionHeader` + count badge + `collapsedSections` store key | Copy this pattern |

**Implication:** no main-process work, no IPC changes, no new status detection. The work is renderer-only (mirrors the [session-restore design] precedent of renderer-only features).

---

## 3. The bucketing function (the one piece of new logic)

A pure function that takes a project's sessions + the agent-status map and returns ordered buckets. This is the testable core.

```ts
// src/renderer/util/sessionBuckets.ts  (NEW)
export type SessionBucketId =
  | 'blocked'    // "Needs you"
  | 'running'    // working agents + active non-claude shells
  | 'done'       // finished, unseen
  | 'idle'       // at prompt, seen
  | 'background' // headless
  | 'exited';    // pty closed (crashed sorts first within)

export interface SessionBucket {
  id: SessionBucketId;
  label: string;
  sessions: TerminalSession[];
}

// Order is the display order — most-urgent first.
const BUCKET_ORDER: { id: SessionBucketId; label: string }[] = [
  { id: 'blocked',    label: 'Needs you' },
  { id: 'running',    label: 'Running' },
  { id: 'done',       label: 'Done' },
  { id: 'idle',       label: 'Idle' },
  { id: 'background', label: 'Background' },
  { id: 'exited',     label: 'Exited' },
];

export function bucketSessions(
  sessions: TerminalSession[],
  agentById: Record<string, AgentState>
): SessionBucket[] { /* classify each session, preserve BUCKET_ORDER, drop empty buckets */ }
```

**Classification rules (decided):**
1. `status === 'exited'` → **exited** (crashed = non-zero `exitCode` sorts to top of bucket).
2. `headless` → **background** (regardless of agent state — matches today's `backgroundTerminals()` partition).
3. Else, by `agentById[id]` (default `'unknown'`):
   - `blocked` → **blocked** (Needs you)
   - `working` → **running**
   - `done` → **done**
   - `idle` → **idle**
   - `unknown` → **running** if `status === 'running'`, else **idle**. *(Plain shells have no agent marker — a live shell reads as Running, a quiet one as Idle. This is the one heuristic; revisit if it feels wrong in practice.)*

Empty buckets are omitted so the column only shows headers that have sessions.

---

## 4. State changes (`useUi`, `store.ts`)

Add a focus flag alongside `selectedProjectId`:

```ts
focusedProjectId: string | null;   // non-null ⇒ column shows focus mode for this project
enterProjectFocus: (id: string) => void;  // sets focusedProjectId = id, selectProject(id)
exitProjectFocus: () => void;             // focusedProjectId = null
```

- **Persistence:** add `focusedProjectId?: string | null` to `AppConfig` (`types.ts:128`) so focus survives relaunch (consistent with how `lastProjectId` is persisted). On init, restore focus only if the project still exists.
- **Collapse state per bucket:** reuse the existing `collapsedSections` map (`store.ts`, localStorage `cc.collapsedSections`) with keys like `focus:${projectId}:${bucketId}`. No new persistence mechanism.

---

## 5. Rendering (`ListPane.tsx`)

`ProjectsList()` gains a branch at the top:

```
if (focusedProjectId) → render <ProjectFocusView project={focused} />
else                  → render today's project list (unchanged)
```

### `ProjectFocusView` (new component, same file or extracted)

```
┌ ← All projects ─────────────────┐   ← back button → exitProjectFocus()
│  ● claude-code-terminal-center   │   ← project header (color dot + name + rollup dot)
├──────────────────────────────────┤
│ NEEDS YOU (1)                     │   ← collapsible SectionHeader + count badge
│   ● claude   refactor store       │   ← reuse existing .project-terminal-row markup
│ RUNNING (2)                       │
│   ● claude   build watcher        │
│   ● shell    npm run dev          │
│ IDLE (1)                          │
│   ○ claude   docs pass            │
│ BACKGROUND (1)                    │
│   ◌ claude   long migration       │   ← resume/kill actions (reuse bg-tray handlers)
│ EXITED (1)                        │
│   ✕ shell    test run (1)         │
└──────────────────────────────────┘
```

**Reuse, don't reinvent:**
- Section headers + count badges + collapse → copy the schedule-groups markup already in `ListPane.tsx`.
- Each session row → reuse the existing `.project-terminal-row` JSX (`ListPane.tsx:554–614`): profile icon, title, `AgentStatusDot`, exit code, unread dot, close/kill button. Clicking a row = `selectTab(projectId, sessionId)` (already wired).
- Background rows → reuse the resume/kill handlers from the TabBar background tray (`restoreTerminal` / kill).
- A "+" new-session affordance in the header (reuse the project's `defaultAgents[0]` one-click create that already exists).

### Wiring the double-click
`.project-item` (`ListPane.tsx:384`) currently has `onClick={() => selectProject(p.id)}`. Add:
```jsx
onDoubleClick={(e) => { e.stopPropagation(); enterProjectFocus(p.id); }}
```
**Conflict to resolve:** the project *name* already has an `onDoubleClick` for rename (`ListPane.tsx:465`). Keep rename on the name (its `stopPropagation` prevents bubbling), so double-clicking the **name** renames, double-clicking elsewhere on the **row** enters focus. Document this; if it feels ambiguous in testing, move rename to a context-menu / F2 only.

---

## 6. Reactivity & the zustand trap (must-read for the implementer)

The [zustand-selector-stable-ref] memory is directly relevant: **never return a fresh array/object from an inline selector** — it infinite-loops React.

- `bucketSessions(...)` returns a fresh array every call, so it **must not** be called inside an inline `useStore(selector)`. Instead: select the raw slices (`terminals[projectId]`, and subscribe to `useAgentStatus.byId` — or a stable derived count), then compute buckets in a `useMemo` keyed on those slices.
- Agent status ticks frequently; `useAgentStatus` was deliberately split off so it doesn't rebuild the `terminals` map. The focus view *does* need to re-render on status change — that's fine, but memoize so only the focused project's buckets recompute, not every project.

---

## 7. Edge cases

- **Focused project deleted / closed** → `exitProjectFocus()` and fall back to the list.
- **Project with zero sessions** → focus view shows the header + an empty state ("No sessions — + to start one"), not a blank column.
- **Remote (SSH) projects** → focus works the same; sessions are remote ptys. No special-casing beyond what already exists.
- **All sessions in one bucket** → only that header shows. Single-bucket case shouldn't feel heavier than today's flat list.
- **Filter box** (`ListPane.tsx` text filter) → in focus mode, repurpose it to filter sessions within the project, or hide it. Recommend: hide in focus mode for simplicity (v1).

---

## 8. Work breakdown (suggested tickets)

| # | Task | Files | Depends on |
|---|---|---|---|
| 1 | `bucketSessions()` pure fn + unit tests (classification table) | `src/renderer/util/sessionBuckets.ts` (new) + test | — |
| 2 | `useUi` focus state (`focusedProjectId`, enter/exit) + `AppConfig` persistence + init restore | `store.ts`, `types.ts` | — |
| 3 | `ProjectFocusView` component (header, grouped sections, reused rows, collapse) | `ListPane.tsx` (+ maybe extract) | 1, 2 |
| 4 | Branch `ProjectsList()` on focus; wire `onDoubleClick` → enter focus; resolve rename conflict | `ListPane.tsx` | 2, 3 |
| 5 | CSS for focus header, back button, group sections | `styles/global.css` | 3 |
| 6 | Manual verification pass: double-click in/out, live status moves sessions between buckets, background resume/kill, relaunch restores focus | — | 4, 5 |

**Sequencing:** 1 and 2 are independent and parallelizable; 3 depends on both; 4–5 follow; 6 is the verification gate. Recommend TDD on ticket 1 — it's the only non-trivial logic and is pure/easily tested.

**Scope guardrail:** renderer-only. If the implementation starts reaching into `src/main/` or adding IPC channels, stop — the signals already arrive in the renderer.

---

## 9. Open questions for the user (non-blocking, can decide during build)

1. **Rename gesture conflict** — keep double-click-name = rename, or move rename to context menu / F2 to make the whole row double-click-to-focus unambiguous?
2. **Single-click in list vs. enter focus** — should single-click *also* eventually enter focus, or is double-click the deliberate "commit" gesture? (Current plan: single = select, double = focus.)
3. **Where does the main workspace/TabBar go in focus mode?** The plan only changes the left column; the main area (TabBar + terminal) is unchanged. Confirm that's the intent (column focuses, workspace stays).

---

### Related memory
- [session-restore-design] — renderer-only session snapshot precedent
- [zustand-selector-stable-ref] — the selector trap this plan must avoid
- [ui-state-localstorage-pattern] — `cc.*` localStorage for UI prefs (used for bucket collapse state)
