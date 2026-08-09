# Plan — "Open a project" navigation + global Agents board default

Branch: `feat/projects-open-and-global-agents-board`

## The ask

1. Stop always showing a project's inner view (Agents / Terminals / Explorer / …) just because a project is selected in the vertical list.
2. Replace **double-click** to open a project with a **single click** (easier).
3. The vertical project list should still be visible, but the inner view should only appear once a project is **opened**.
4. The **default** view (nothing opened) should be a **global Agents board** — the Kanban-style board, but across **ALL projects** — so at a glance you see every agent working everywhere.

## What already exists (reuse, don't rebuild)

- **`focusedProjectId` + `enterProjectFocus`/`exitProjectFocus`** already model "drill into one project." Today it's bound to **double-click** and it swaps the *list column* into a per-project session view (`ProjectFocusView`). This is exactly the "opened project" concept.
- **`ProjectAgentsBoard`** (just shipped) renders a Kanban board for one project. It's nearly parameterizable to "all projects."
- **`OverviewPanel`** already renders in column 3 when `overviewOpen` is true — a precedent for "a default panel that isn't a project's workspace."
- The **single `TerminalSurface`** portals live terminals into whichever view owns column 3. The global board is a list/board (no terminal host), so it doesn't disturb that.

## Design

### Model: "opened" = `focusedProjectId`

We already have the state; we just change **what gates the inner workspace** and **what triggers open/close**.

- **Single click** a project row → `selectProject(id)` only (highlight it; do NOT open). *(Optional: a single click could also open — see Decision 1.)*
- **Open** a project → `enterProjectFocus(id)` (sets `focusedProjectId`). Triggered by single-click per the ask (Decision 1 picks the exact gesture).
- **Close** → `exitProjectFocus()` (clears it), via the existing "← All projects" back button.

### Column 3 (the main view), under `nav === 'projects'`

```
focusedProjectId set?
  ├─ yes → <Workspace />              (the project's Agents/Terminals/Explorer/… — today's view)
  └─ no  → <GlobalAgentsBoard />      (NEW: Kanban across all projects)
```

`overviewOpen` (the existing "Overview" grid) stays as-is, or we fold it into the new default — see Decision 2.

### The global board

Generalize `ProjectAgentsBoard` into a board that accepts **either** one project's sessions **or** all projects'. Cross-project cards gain a small **project chip** (name + color dot) so you can tell whose agent it is. Same four lanes (Needs you / Working / Idle / Done), same pulse/sweep/live-timer treatment. Clicking a card **opens that card's project** and focuses the agent's terminal — i.e. `enterProjectFocus(projectId)` + select the tab.

Cleanest implementation: extract the board's card/lane rendering into a shared piece that takes a flat `AgentCard[]` (each carrying `projectId`/`projectName`/`color`), and feed it from either:
- one project (`ProjectAgentsBoard`, today), or
- all projects (`GlobalAgentsBoard`, new — reuses the global `useAgentRows`-style flattening already in `AgentsView`).

### The list column (column 2)

- Keep the project list always visible (the ask).
- When a project is **opened**, the existing `ProjectFocusView` already takes over the list column with its "← All projects" header + per-project session buckets. That's the natural "you're inside this project" affordance — keep it.
- The **"Overview"** button at the top of the list becomes the entry to the global board (or we relabel it "Agents" / "All agents"). See Decision 2.

## Open decisions (need your call)

### Decision 1 — what does single-click do?
The ask says "replace double-click by single click to open." Two readings:
- **(A) Single-click opens immediately.** Simplest match to the words. Downside: you can no longer select-without-opening (e.g. to use the right-click menu or recolor) without opening — though the "← All projects" back button makes leaving cheap.
- **(B) Single-click selects; a second single-click (or Enter) opens.** Keeps a select state. More familiar (Finder-like) but arguably not what was asked.

Leaning **(A)** — it's literally what you asked and the back button makes it low-cost.

### Decision 2 — what is the default (no project open) view?
- **(A) Global Agents board replaces the default.** The "Overview" grid is removed/relabeled; the board is THE home. Matches "by default we should see a view of the agents working."
- **(B) Global Agents board is the new default, Overview kept as a secondary toggle.** Less disruptive; both available.

Leaning **(A)** for focus, but **(B)** is safer if you still like the workspace-overview grid.

### Decision 3 — keep per-project Agents mode tab?
The per-project `ProjectAgentsBoard` (the "Agents" tab inside an opened project) — keep it (consistent: board at both levels), or drop it now that the global board is the headline? Leaning **keep**.

## Rollout (once decisions are locked)

1. Extract shared board rendering (`AgentBoardLanes` taking `AgentCard[]`); refactor `ProjectAgentsBoard` onto it. *(no behavior change — safe first step)*
2. Add `GlobalAgentsBoard` (all projects, project chips, click → open project + focus tab).
3. App.tsx: gate column 3 on `focusedProjectId` — `Workspace` when set, `GlobalAgentsBoard` when not.
4. ListPane: single-click → open (Decision 1); remove the double-click handler; relabel/redirect the "Overview" entry (Decision 2).
5. Persisted `focusedProjectId` already survives relaunch — confirm the default (no focus) lands on the board, not an empty workspace.
6. Tests: board flattening/sorting across projects; click-to-open wiring; palette/keyboard parity. Update the buildItems golden snapshot if commands change.
```
```

## Risks / watch-items

- **Don't remount `TerminalSurface`.** The global board has no terminal host; switching focus on/off must not unmount the surface (it lives outside the conditional in App.tsx — keep it there).
- **Render-storm guard:** the board subscribes to `terminals` + `useAgentStatus.byId`; derive cards behind `useMemo` (already the pattern) so a status tick doesn't rebuild everything.
- **Empty states:** no projects at all; projects but zero agents; a project open but no sessions.
- **Keyboard/palette parity:** opening a project via click should have a palette/⌘ equivalent.
