# Squad Flow — multi-squad switcher + full-height focused squad

**Date:** 2026-06-22
**Status:** Approved design (pre-implementation)
**Area:** Renderer — Agents board "Flow" view
**Scope:** Presentational only. No main-process / IPC / path / store-schema changes.

## Problem

The Agents board "Flow" view (`SquadFlowView`) renders **one graph per project that has
live agents**, stacked vertically inside one scrolling column (`.squad-flow`). When more
than one squad is running this is "very unclear":

1. **No focus.** Several squad graphs stack in one scroll, so there is no clear "I am
   looking at squad X." After the recent scroll fix each canvas can grow to `56vh`, so
   stacked squads make a tall, undifferentiated scroll.
2. **Ambiguous labels.** The squad descriptor (`graph.squad`) is usually `undefined` —
   squads have no runtime template→session binding (see `squadFlow.ts` header). The
   header then falls back to a generic **"🤖 Squad"**, so multiple stacked squads can all
   read "Squad."
3. **Wastes space.** The focused squad should occupy the **whole board area**, not the
   `56vh` slice the canvas is capped at today (that cap existed only to keep *stacked*
   squads from each hogging the screen).

## Goals

- Show **one squad at a time**, chosen via a switcher at the top of the Flow view.
- The selected squad's graph **fills the entire board area** (top to bottom), scrolling
  **internally** only when the graph is bigger than the available space.
- Every squad in the switcher is **unambiguously labelled** even when no template
  descriptor exists.
- **Sticky selection:** stay on the selected squad; new squads do not steal focus; if the
  selected squad exits, fall back to the first remaining one.
- Zero new chrome for the common single-squad case — it looks like today (but full-height).

## Non-goals

- No persistence of the selected squad across app restarts (in-memory only — confirmed).
- No change to the projection (`buildSquadFlow`), the per-node layout (`layout()`), the
  edge/handoff model, or the recent scroll fix internals.
- No grid / accordion / all-visible layout (explicitly chose one-at-a-time).
- No new IPC, no store-schema or persisted-preference changes.

## Behavior

### Switcher visibility
- **0 squads:** the existing empty state ("No squads running"). Unchanged.
- **1 squad:** **no switcher.** Render that squad full-height. (No new chrome.)
- **2+ squads:** render the `SquadSwitcher` chip row above the canvas; render only the
  selected squad's graph below it, full-height.

### Switcher chips
Each chip represents one squad (one project's graph) and shows, left→right:
- the squad icon (`graph.squad?.icon ?? '🤖'`),
- a **project-derived label** (see "Labelling" below),
- a live status dot + working count when `summary.working > 0` (reusing the `agent-*`
  status-dot vocabulary), e.g. `🎨 zana-command-center  ●3`.
- A subtle "new" affordance on a squad that appeared after the user's current selection
  was established (a small unlabelled dot on the chip). This is a **cosmetic cue only** —
  see "New-squad cue" for its bounded, non-persisted definition.

The **selected** chip is visually active (border/background per the existing
`squad-flow-*` active styling idiom). Chips are real `<button type="button">` elements,
in document order = graph list order (deterministic, matches `SquadFlowView`'s existing
project-iteration order), keyboard-focusable, with `aria-pressed` reflecting selection
and an `aria-label` naming the squad.

### Labelling (the real clarity fix)
Because `graph.squad` is usually absent, label by **project**, which is always available:

```
displayLabel = graph.squad?.name ?? project.name ?? graph.projectId
displayIcon  = graph.squad?.icon ?? '🤖'
accentColor  = project.color   // used as a thin accent on the chip
```

`SquadFlowView` already has `projects` in scope; build a local `projectId → project` map
(cheap, memoized) and pass the resolved `{ label, icon, color }` to each chip. No new
store wiring. This guarantees every chip is distinguishable even with no template
metadata. (The per-graph `SquadGraph` header keeps its current behaviour; only the
switcher needs project resolution. Optionally the header can adopt the same fallback for
consistency — see "Optional polish.")

### Selection (sticky) — pure reducer
Selection is the **selected squad's `projectId`**, held in component state (in-memory,
not persisted). On every render the current graph list is reconciled through a **pure
helper** so behaviour is testable without the component:

```ts
/** Given the previously-selected projectId and the current graph list (in display
 *  order), return the projectId that should be selected now.
 *  - keep prev if it still exists  (sticky: new squads don't steal focus)
 *  - else fall back to the first graph  (exit fallback)
 *  - else undefined  (empty list) */
export function reconcileSquadSelection(
  prev: string | undefined,
  graphs: { projectId: string }[]
): string | undefined {
  if (prev && graphs.some((g) => g.projectId === prev)) return prev;
  return graphs[0]?.projectId;
}
```

- **New squad starts:** `prev` still present → unchanged → canvas stays. The new graph
  appears as a chip (with the "new" cue).
- **Selected squad exits:** `prev` gone → first remaining graph selected.
- **All squads gone:** `undefined` → empty state.

`SquadFlowView` applies this each render and, when the result differs from state, commits
it (guarded `setState`/effect to avoid an update loop — only write when changed). The
selected `SquadFlowGraph` is then the one whose `projectId === selected`.

### New-squad cue (bounded, non-persisted)
"New" is a soft cue, not tracked history. Definition: the set of `projectId`s seen on the
**first render with a committed selection** is remembered in a ref; any squad whose
`projectId` is not in that set is "new" until the user selects it (selecting clears its
new-flag). This needs no store/IPC and resets on reload (consistent with in-memory
selection). If this proves fiddly during implementation it may be dropped — it is the
lowest-priority element of the design and must not block the core feature.

### Full-height focused squad (the "take the whole place" fix)
The flex chain from column 3 down already supports filling the area
(`.agents-board` and `.squad-flow` are both `flex: 1; min-height: 0`). Two links don't
stretch today; fix both, and remove the `56vh` cap:

- **`.squad-flow-canvas`** — remove `max-height: 56vh` and `min-height: 280px`; add
  `flex: 1; min-height: 0;`. Keep `overflow: auto` (internal scroll), `overscroll-behavior`,
  the border/radius/margin, and the dot-grid background. Result: the canvas grows to fill
  available height and only scrolls internally when the graph exceeds it.
- **`.squad-flow-squad`** — add `flex: 1; min-height: 0;` so the squad section stretches
  to fill `.squad-flow` (today it sizes to content, leaving dead space below). Header is
  fixed-height; the canvas takes the rest (`flex: 1`).
- **`.squad-flow`** — stays `flex: 1; min-height: 0`. With a single rendered squad nothing
  overflows it (the inner canvas owns the scroll), so its `overflow-y`/`gap` become
  harmless; leave as-is to minimise churn. The switcher row, when present, is a fixed-height
  child above the squad section.

Resulting layout:
`agents-board (fills col 3) → squad-flow (fills board) → [SquadSwitcher (fixed)] +
squad-flow-squad (flex:1) → header (fixed) + squad-flow-canvas (flex:1, internal scroll)`.

This applies uniformly. The **per-project board** (passes `projectId`, always ≤1 squad,
no switcher) also gets the full-height canvas — desirable, no special-casing.

## Components / structure

- **`SquadSwitcher`** (new, presentational, pure):
  - Props: `items: { projectId, label, icon, color, working, isNew }[]`,
    `selected: string | undefined`, `onSelect: (projectId: string) => void`.
  - Renders the chip row. No store access; fully testable in isolation.
- **`reconcileSquadSelection`** (new, pure helper) — exported for unit tests. Lives in
  `SquadFlowView.tsx` or a small sibling util; either is fine (keep it near its only caller
  unless reuse appears).
- **`SquadFlowView`** (modified) — owns selection state (`useState<string>()`), builds the
  `projectId → project` map, derives switcher `items` (memoized), applies
  `reconcileSquadSelection`, renders `<SquadSwitcher>` (only when `graphs.length > 1`) +
  the single selected `<SquadGraph>`.
- **`SquadGraph`**, **`layout()`**, **`buildSquadFlow`** — unchanged.

### State shape
- `selectedProjectId: string | undefined` — component state, in-memory.
- `seenProjectIds: Set<string>` (ref) — for the "new" cue only; not persisted.

## CSS (squad-flow-* namespace only — Rule 6 / coupling-safe)

- New: `.squad-flow-switcher` (the chip row: horizontal flex, wraps or scrolls-x on
  overflow, fixed-height, sits above the squad section), `.squad-flow-tab` (chip),
  `.squad-flow-tab.active` (selected), `.squad-flow-tab--new` (cue dot). Reuse `agent-*`
  status-dot classes for the live dot. Match existing `agents-view-toggle` / `squad-flow-*`
  visual idiom (border, radius, accent).
- Modified: `.squad-flow-canvas` (drop caps, add `flex:1; min-height:0`),
  `.squad-flow-squad` (add `flex:1; min-height:0`).
- **Do NOT touch** `gus-*` or `agent-mesh-*` classes (CLAUDE.md coupling note). No shared
  status-dot restyle.

## Accessibility

- Chips are `<button type="button">` with `aria-pressed` = selected and an `aria-label`
  naming the squad (e.g. "Frontend Squad, 3 working"). Tab order = display order.
- Switcher row is a `role="tablist"`-style group OR a plain button group; given the canvas
  is not a strict ARIA tabpanel, use a labelled `role="group"` with `aria-label="Squads"`
  and `aria-pressed` toggles (simpler, honest about semantics). Decide at implementation;
  prefer the simplest correct semantics over forcing the tab/tabpanel pattern.
- Full-height canvas keeps the existing focusable nodes and `:focus-visible` outline; the
  internal scroll is keyboard-scrollable. No smooth-scroll, no new motion.

## Testing

1. **`reconcileSquadSelection` unit tests** (pure): keep-existing (sticky / new squad
   doesn't steal), exit-fallback to first remaining, empty list → undefined, no-prior
   selection → first.
2. **`SquadSwitcher` render test:** renders one chip per item; clicking a chip fires
   `onSelect` with its `projectId`; active chip reflects `selected`.
3. **`SquadFlowView` integration-ish test (where feasible with the existing renderer test
   setup):** 1 squad → no switcher; 2 squads → switcher with 2 chips and only the selected
   graph rendered.
4. **CSS guard:** extend (or add alongside) the existing
   `squad-flow-scrollable.guard.test.ts` to assert `.squad-flow-canvas` is no longer
   `max-height: 56vh` and declares `flex: 1` (full-height), and still `overflow: auto`.

## Risks / trade-offs

- **`overflow-y` on `.squad-flow` now redundant** with a single squad. Left as-is to
  minimise churn; harmless because the inner canvas owns the scroll. If it ever
  double-scrolls in practice, drop it then.
- **"New" cue is heuristic** and resets on reload (acceptable, matches in-memory selection).
  Lowest priority; may be cut without affecting the core feature.
- **Selection-commit loop:** must only `setState` when the reconciled id differs from the
  current one, or React will loop. Covered by the "commit only when changed" guard.
- **Switcher overflow with many squads:** the chip row must wrap or scroll-x; pick one in
  CSS (prefer horizontal scroll to keep the canvas height stable).

## Files (anticipated)

- `src/renderer/components/SquadFlowView.tsx` — selection state, project map, switcher
  items, `reconcileSquadSelection`, render `<SquadSwitcher>` + single graph. (`SquadSwitcher`
  may live here or in its own file.)
- `src/renderer/styles/global.css` — new `.squad-flow-switcher` / `.squad-flow-tab*`;
  modified `.squad-flow-canvas` / `.squad-flow-squad`.
- `src/renderer/util/__tests__/squadFlow.test.ts` or a new test file — `reconcileSquadSelection`
  + switcher tests.
- `src/renderer/__tests__/squad-flow-scrollable.guard.test.ts` — extend the CSS guard for
  full-height.
