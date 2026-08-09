# Edit the squad's team template from the Flow view

**Date:** 2026-07-07
**Status:** SUPERSEDED — wrong target. Replaced by
`2026-07-07-edit-zana-team-template-from-hub-design.md`.

> This spec designed editing the **app-native `Team`** (`~/.zcc/teams`) from the
> Flow view. The actual intent was to edit the **Zana daemon's templates**
> (`~/.zana/teams/<id>.json`) from the **Zana extension's Teams tab**. See the
> superseding spec. Kept for history; do not implement.

## Problem

The Agents board's **Flow** view (`SquadFlowView`) renders a live squad — the
runtime mesh of a team launch — but it's view-only. To change the roster
(personas, orchestrator, opening prompt) the user has to leave Flow, go to the
**Teams** panel, find the right team, and open its editor. We want to edit the
squad's underlying **Team template** directly from the Flow view.

Scope is the **persisted `Team`**, not the live mesh: no live add/remove-agent,
no auto-relaunch. Editing the template affects the *next* launch.

## Key facts (the bridge already exists)

- A **`Team`** (`src/shared/types.ts`) is the persisted, editable bundle of
  persona slots. It already has a full editor: `TeamEditor.tsx`, opened today
  only from `TeamsPanel.tsx`.
- A **squad** in the Flow view is one *team launch*, keyed by
  `AgentRecord.teamLaunchId` — an opaque per-launch UUID (`squadLaunchGroups.ts`
  calls this the `launchId`).
- Every team-launched **session** carries `session.cohort` (`SessionCohort`),
  whose `cohortId` **equals** that `launchId` (both minted from the same
  `randomUUID()` in `launchTeam`, `src/main/index.ts`) and whose **`teamId`
  equals the `Team.id`** it was launched from.
- Therefore a live squad → its `Team` is resolvable entirely from data already
  in the renderer store (`useData().terminals` + `useTeams().teams`). **No new
  IPC**, and we read `cohort.teamId` as data — no Rule-6 literal branching.
- The solo bucket (`SOLO_LAUNCH_ID`), unregistered sessions, deleted templates,
  and (for "All squads") a mesh mixing multiple teams have **no single resolvable
  Team** → the edit affordance is simply absent.

## Approach (chosen: A — "Edit team" in the Flow header)

Add an **"Edit team"** button to the squad header. When the active squad
resolves to a `Team`, clicking it opens the **existing `TeamEditor`** modal in
place (rendered inside `SquadFlowView`). This reuses all editor logic, keeps the
user in the Flow context, and adds the smallest new surface.

Rejected alternatives:
- **B — inline roster editing on the canvas.** Duplicates `TeamEditor` and
  conflates *live agents* (what the canvas shows) with *template slots* (what you
  edit). Rejected.
- **C — deep-link to the Teams panel.** Simplest, but yanks the user out of Flow.
  Rejected.

## Components & data flow

### 1. `resolveSquadTeam` — pure helper (new)

New file `src/renderer/util/resolveSquadTeam.ts` (unit-testable, no IPC/store):

```
resolveSquadTeam(
  launchId: string,                 // selectedSquad: a launchId, or ALL_SQUADS
  graph: SquadFlowGraph,            // the active graph (its projectId + node sessionIds)
  sessions: TerminalSession[],      // the project's listed terminals
  teams: Team[]
): Team | null
```

`graph` is used only to bound the `ALL_SQUADS` member set (its
`nodes[].sessionId`); for a specific launchId the `sessions` list alone
determines membership via `cohort.cohortId`.

Logic:
- Collect the `cohort.teamId` for the sessions that belong to this squad:
  - **Specific launchId:** sessions whose `cohort.cohortId === launchId`.
  - **`ALL_SQUADS`:** sessions whose `id` is one of `graph.nodes[].sessionId`
    (the merged graph's members) and that have a `cohort`.
- If the set of distinct `teamId`s is exactly one, look it up in `teams` and
  return it. Otherwise (zero cohorts, mixed teamIds, solo bucket, or teamId not
  in `teams` because the template was deleted) return `null`.

Rationale for the `ALL_SQUADS` "must be unanimous" rule: the merged graph can
span several launches of possibly-different teams; editing is only unambiguous
when they're all the same team.

### 2. `SquadFlowView` wiring

- Compute the resolved team with `useMemo` over
  `(selectedSquad, activeGraph, terminals[selected], teams)`.
- Hold local editor state: `const [editorTeam, setEditorTeam] = useState<Team | null>(null)`.
- Subscribe to `useTeams((s) => s.teams)`.
- Pass `team={resolvedTeam}` and `onEditTeam={() => setEditorTeam(resolvedTeam)}`
  into `SquadGraph`.
- Render `<TeamEditor>` when `editorTeam` is set, choosing mode the same way
  `TeamsPanel` does: `editorTeam.source === 'user' ? 'edit' : 'view'` (builtins →
  "Edit override", project/extension → "Duplicate to user" / read-only detail).
  `onClose={() => setEditorTeam(null)}`.

### 3. `SquadGraph` header button

- Accept optional props `editTeam?: () => void` and `canEdit?: boolean`.
- In `.squad-flow-head`, after `.squad-flow-rollup`, render a compact icon+label
  button (`Pencil` from lucide, class `squad-flow-edit-team`) **only when
  `canEdit`**. `title="Edit this squad's team template"`.
- Purely presentational; all resolution happens in the parent.

### 4. Editor note (template vs. live)

Editing the template does **not** change running agents. `TeamEditor` already
notes where teams are saved. We will **not** re-plumb `TeamEditor` for this;
instead the button's `title`/adjacent helper text makes clear it edits the
*template* (applies to the next launch). No new re-launch action in this change —
the existing Teams-panel Launch remains the path to apply changes.

## Error / edge handling

- **No resolvable team** (solo, mixed, deleted, no cohort) → button hidden. No
  errors, no dead-ends.
- **Team deleted while the modal is open** → save/delete already go through
  `cc.teams.*` which re-validates in main (renderer untrusted, Rule 1); a stale
  id fails cleanly with a toast (existing behavior).
- **`ALL_SQUADS` with mixed teams** → hidden (documented above), so the user
  first narrows to a single squad chip.

## Testing

- `src/renderer/util/__tests__/resolveSquadTeam.test.ts`:
  - specific launchId → its team;
  - `ALL_SQUADS` unanimous → that team; mixed → null;
  - solo bucket → null;
  - teamId absent from `teams` (deleted) → null;
  - no cohort on any session → null.
- Render test (extend an existing `SquadFlowView`/board test or add one): button
  present only when a team resolves, and clicking mounts `TeamEditor`.

## Non-goals

- No live roster mutation (add/close/reassign running agents).
- No auto-relaunch on save.
- No new IPC or main-process changes.
- No changes to the `gus-*` shared classes (new styles use `squad-flow-*`, per
  the CLAUDE.md coupling note).
