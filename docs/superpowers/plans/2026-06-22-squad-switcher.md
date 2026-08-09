# Squad Switcher + Full-Height Focused Squad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one squad at a time in the Agents "Flow" view via a project-labelled switcher, with the focused squad filling the entire board area instead of a 56vh slice.

**Architecture:** Renderer-only change to `SquadFlowView`. A pure `reconcileSquadSelection` helper drives sticky selection (in-memory `useState`); a new presentational `SquadSwitcher` renders the chip row (shown only when 2+ squads). CSS removes the `56vh` cap and makes `.squad-flow-canvas` / `.squad-flow-squad` `flex: 1` so the single rendered graph owns the full height and scrolls internally. The projection (`buildSquadFlow`), per-node `layout()`, and `SquadGraph` are untouched.

**Tech Stack:** React + TypeScript (Electron renderer), Zustand store, Vitest. CSS in `src/renderer/styles/global.css`.

## Global Constraints

- **Renderer is untrusted; no main-process / IPC / path / store-schema changes** — this is presentational only.
- **CSS stays in the `squad-flow-*` namespace.** Do NOT touch or restyle shared `gus-*` or `agent-mesh-*` classes (CLAUDE.md coupling note). Reuse the `agent-*` status-dot vocabulary as-is; do not restyle it.
- **No literal `'zana'` in logic** (Rule 6) — label squads from generic `project`/`squad` data, never by branching on an extension id.
- **Selection is in-memory only** — not persisted across app restarts (no new persisted preference).
- **Match surrounding code style** — comment density, naming (`squad-flow-*`), `<button type="button">` for clickable chips.
- Test runner: `npx vitest run <file>`. Typecheck: `npm run typecheck`. Full suite: `npm test`.

---

### Task 1: `reconcileSquadSelection` pure helper + tests

The sticky-selection reducer. Pure function, unit-tested in isolation, exported from `SquadFlowView.tsx` so the component and tests both use it.

**Files:**
- Modify: `src/renderer/components/SquadFlowView.tsx` (add exported helper near the top, after imports / before `prettyLabel`)
- Test: `src/renderer/util/__tests__/squadSelection.test.ts` (Create)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `export function reconcileSquadSelection(prev: string | undefined, graphs: { projectId: string }[]): string | undefined`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/util/__tests__/squadSelection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcileSquadSelection } from '../../components/SquadFlowView.js';

const g = (...ids: string[]) => ids.map((projectId) => ({ projectId }));

describe('reconcileSquadSelection', () => {
  it('keeps the previous selection when it still exists (sticky)', () => {
    expect(reconcileSquadSelection('b', g('a', 'b', 'c'))).toBe('b');
  });

  it('does not let a newly-added squad steal focus', () => {
    // prev 'a' still present after 'd' appears → stays on 'a'
    expect(reconcileSquadSelection('a', g('a', 'b', 'd'))).toBe('a');
  });

  it('falls back to the first graph when the selection exited', () => {
    expect(reconcileSquadSelection('gone', g('x', 'y'))).toBe('x');
  });

  it('selects the first graph when nothing was selected yet', () => {
    expect(reconcileSquadSelection(undefined, g('first', 'second'))).toBe('first');
  });

  it('returns undefined when there are no graphs', () => {
    expect(reconcileSquadSelection('a', [])).toBeUndefined();
    expect(reconcileSquadSelection(undefined, [])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/util/__tests__/squadSelection.test.ts`
Expected: FAIL — `reconcileSquadSelection` is not exported (import error / undefined).

- [ ] **Step 3: Write minimal implementation**

In `src/renderer/components/SquadFlowView.tsx`, immediately after the imports block (after line 13, before the `prettyLabel` doc comment), add:

```ts
/**
 * Sticky squad-selection reducer for the Flow view's switcher. Given the
 * previously-selected projectId and the current graph list (in display order),
 * returns the projectId that should be selected now:
 *   - keep `prev` if it still exists  → new squads never steal focus
 *   - else fall back to the first graph → exit fallback
 *   - else undefined → no squads
 * Pure (in-memory selection, no persistence) so it's unit-testable.
 */
export function reconcileSquadSelection(
  prev: string | undefined,
  graphs: { projectId: string }[]
): string | undefined {
  if (prev && graphs.some((g) => g.projectId === prev)) return prev;
  return graphs[0]?.projectId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/util/__tests__/squadSelection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SquadFlowView.tsx src/renderer/util/__tests__/squadSelection.test.ts
git commit -m "feat(squad-flow): add sticky reconcileSquadSelection reducer"
```

---

### Task 2: `SquadSwitcher` presentational component + render test

The chip row. Pure presentational — no store access — so it's testable with a plain render. Lives in its own file for focus.

**Files:**
- Create: `src/renderer/components/SquadSwitcher.tsx`
- Test: `src/renderer/components/__tests__/SquadSwitcher.test.tsx` (Create)

**Interfaces:**
- Consumes: nothing (pure props).
- Produces:
  ```ts
  export interface SquadSwitcherItem {
    projectId: string;
    label: string;
    icon: string;
    color?: string;
    working: number;
    isNew: boolean;
  }
  export function SquadSwitcher(props: {
    items: SquadSwitcherItem[];
    selected: string | undefined;
    onSelect: (projectId: string) => void;
  }): JSX.Element;
  ```

> **Repo testing convention (IMPORTANT):** This repo has **no `@testing-library/react` and no jsdom** configured (vitest runs in the default node environment). Component `.tsx` tests here either test extracted pure logic or render to a string via `renderToStaticMarkup` from `react-dom/server` (see `src/renderer/components/__tests__/OverviewPanel.test.tsx`). Do **NOT** install a new dependency. Use `renderToStaticMarkup` and assert on the produced HTML. Click simulation is not available without jsdom (consistent with `TeamsPanel.test.tsx`'s documented "no jsdom, no click simulation" stance); the `onSelect` wiring is one trivial inline line, exercised by Task 3's integration and the manual-verification recipe, so it is intentionally not unit-tested here.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/__tests__/SquadSwitcher.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SquadSwitcher, type SquadSwitcherItem } from '../SquadSwitcher';

const items: SquadSwitcherItem[] = [
  { projectId: 'p1', label: 'Frontend', icon: '🎨', color: '#f00', working: 3, isNew: false },
  { projectId: 'p2', label: 'Research', icon: '🔬', color: '#0f0', working: 0, isNew: true }
];

const html = () =>
  renderToStaticMarkup(<SquadSwitcher items={items} selected="p1" onSelect={() => {}} />);

describe('SquadSwitcher', () => {
  it('renders one chip per item with its label', () => {
    const out = html();
    expect(out.match(/<button/g)?.length).toBe(2);
    expect(out).toContain('Frontend');
    expect(out).toContain('Research');
  });

  it('marks the selected chip active and the other not', () => {
    const out = html();
    expect(out).toContain('squad-flow-tab active');
    expect(out.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(out.match(/aria-pressed="false"/g)?.length).toBe(1);
  });

  it('renders a working-count only for squads with working > 0', () => {
    // p1 has working:3 → one count span; p2 has working:0 → none.
    expect(html().match(/squad-flow-tab-count/g)?.length).toBe(1);
  });

  it('flags a new, unselected squad with the --new modifier', () => {
    // p2 is isNew:true and not selected.
    expect(html()).toContain('squad-flow-tab--new');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/__tests__/SquadSwitcher.test.tsx`
Expected: FAIL — cannot resolve `../SquadSwitcher` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/components/SquadSwitcher.tsx`:

```tsx
/**
 * Squad switcher for the Agents "Flow" view: a horizontal chip row, one chip per
 * running squad, shown only when 2+ squads exist. Each chip is labelled by its
 * project (squads usually have no template descriptor, so the project name +
 * color is the authoritative identity) and carries a live working-count dot.
 * Pure presentational — selection state lives in SquadFlowView. Reuses the
 * shared `agent-*` status-dot vocabulary; all other styling is `squad-flow-*`.
 */

export interface SquadSwitcherItem {
  projectId: string;
  /** Display label — squad name when known, else project name. */
  label: string;
  /** Squad icon hint, or a generic fallback. */
  icon: string;
  /** Project accent color (optional). */
  color?: string;
  /** Live working count (drives the dot + count). */
  working: number;
  /** Appeared after the user's current selection was established. */
  isNew: boolean;
}

interface SquadSwitcherProps {
  items: SquadSwitcherItem[];
  selected: string | undefined;
  onSelect: (projectId: string) => void;
}

export function SquadSwitcher({ items, selected, onSelect }: SquadSwitcherProps) {
  return (
    <div className="squad-flow-switcher" role="group" aria-label="Squads">
      {items.map((item) => {
        const isSelected = item.projectId === selected;
        const aria = item.working > 0 ? `${item.label}, ${item.working} working` : item.label;
        return (
          <button
            key={item.projectId}
            type="button"
            className={`squad-flow-tab ${isSelected ? 'active' : ''} ${item.isNew ? 'squad-flow-tab--new' : ''}`}
            style={item.color ? { ['--squad-tab-accent' as string]: item.color } : undefined}
            aria-pressed={isSelected}
            aria-label={aria}
            onClick={() => onSelect(item.projectId)}
          >
            <span className="squad-flow-tab-icon" aria-hidden="true">{item.icon}</span>
            <span className="squad-flow-tab-label">{item.label}</span>
            {item.working > 0 && (
              <span className="squad-flow-tab-count">
                <span className="tab-agent-dot agent-working" aria-hidden="true" />
                {item.working}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/__tests__/SquadSwitcher.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SquadSwitcher.tsx src/renderer/components/__tests__/SquadSwitcher.test.tsx
git commit -m "feat(squad-flow): add SquadSwitcher chip-row component"
```

---

### Task 3: Wire selection + switcher into `SquadFlowView`

Hold in-memory selection, build switcher items (project-resolved labels + "new" cue), render the switcher (only when 2+ squads) and the single selected graph.

**Files:**
- Modify: `src/renderer/components/SquadFlowView.tsx` (imports; the `SquadFlowView` function body, currently lines 289–355)

**Interfaces:**
- Consumes: `reconcileSquadSelection` (Task 1), `SquadSwitcher` + `SquadSwitcherItem` (Task 2), `graphs: SquadFlowGraph[]` (already built in the component), `projects` from `useData` (already in scope).
- Produces: no new exports.

- [ ] **Step 1: Add imports**

At the top of `src/renderer/components/SquadFlowView.tsx`:
- Change `import { useMemo } from 'react';` (line 1) to:
  ```ts
  import { useMemo, useRef, useState } from 'react';
  ```
- After the `buildSquadFlow` import (line 13) add:
  ```ts
  import { SquadSwitcher, type SquadSwitcherItem } from './SquadSwitcher';
  ```

- [ ] **Step 2: Replace the render tail of `SquadFlowView`**

The current function ends with (lines ~335–354) the empty-state guard and a `.squad-flow` div that maps EVERY graph to a `SquadGraph`. Replace from the `if (graphs.length === 0) {` block through the closing of the function's `return` with:

```tsx
  const byProjectId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // In-memory sticky selection: keep the chosen squad while it exists; new
  // squads don't steal focus; fall back to the first when the selection exits.
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const selected = reconcileSquadSelection(selectedId, graphs);
  // Commit the reconciled id back to state ONLY when it differs, or we'd loop.
  if (selected !== selectedId) setSelectedId(selected);

  // "New" cue: projectIds present when the first selection was committed. Any
  // squad not in this set is "new" until selected. Ref so it survives renders
  // but resets on reload (consistent with in-memory selection).
  const seenRef = useRef<Set<string> | null>(null);
  if (seenRef.current === null && graphs.length > 0) {
    seenRef.current = new Set(graphs.map((g) => g.projectId));
  }
  const seen = seenRef.current ?? new Set<string>();

  if (graphs.length === 0) {
    return (
      <div className="squad-flow-empty">
        <Workflow size={28} aria-hidden="true" />
        <h4>No squads running</h4>
        <p>
          When you launch a team, its members appear here as a live flow — who&rsquo;s working,
          who&rsquo;s blocked, and how work hands off between them.
        </p>
      </div>
    );
  }

  const items: SquadSwitcherItem[] = graphs.map((g) => {
    const project = byProjectId.get(g.projectId);
    return {
      projectId: g.projectId,
      label: g.squad?.name ?? project?.name ?? g.projectId,
      icon: g.squad?.icon ?? '🤖',
      color: project?.color,
      working: g.summary.working,
      isNew: !seen.has(g.projectId) && g.projectId !== selected
    };
  });

  const activeGraph = graphs.find((g) => g.projectId === selected) ?? graphs[0];

  return (
    <div className="squad-flow">
      {graphs.length > 1 && (
        <SquadSwitcher items={items} selected={selected} onSelect={setSelectedId} />
      )}
      <SquadGraph key={activeGraph.projectId} graph={activeGraph} />
    </div>
  );
}
```

> Notes for the implementer:
> - `projects` is already pulled via `useData((s) => s.projects)` near the top of `SquadFlowView` — do not re-declare it.
> - The `if (selected !== selectedId) setSelectedId(...)` set-during-render is React's sanctioned "adjust state on prop/derived change" pattern; it only fires when the reconciled id actually changes, so it converges in one extra render and does not loop.
> - Selecting a chip calls `setSelectedId(projectId)`; that id exists in `graphs`, so `reconcileSquadSelection` keeps it.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors. (If the `['--squad-tab-accent' as string]` inline-var cast in Task 2 errors, it won't surface here — that file already typechecked in Task 2.)

- [ ] **Step 4: Run the renderer suite for regressions**

Run: `npx vitest run src/renderer/components/__tests__/SquadSwitcher.test.tsx src/renderer/util/__tests__/squadSelection.test.ts src/renderer/util/__tests__/squadFlow.test.ts`
Expected: PASS (all). `buildSquadFlow` tests unchanged and green.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SquadFlowView.tsx
git commit -m "feat(squad-flow): single focused squad with sticky project-labelled switcher"
```

---

### Task 4: CSS — full-height canvas + switcher styling

Remove the `56vh` cap so the focused squad fills the board; make the squad section and canvas stretch; style the switcher chips in the `squad-flow-*` namespace.

**Files:**
- Modify: `src/renderer/styles/global.css` — `.squad-flow-squad` (line 14897), `.squad-flow-canvas` (line 14954); add `.squad-flow-switcher` / `.squad-flow-tab*` near them.

**Interfaces:**
- Consumes: `--border`, `--border-strong`, `--bg-elevated`, `--accent-blue`, `--text-dim` design tokens (already used by neighboring `squad-flow-*` / `agents-view-toggle` rules).
- Produces: the `.squad-flow-switcher` / `.squad-flow-tab` classes consumed by `SquadSwitcher` (Task 2).

- [ ] **Step 1: Make `.squad-flow-squad` stretch**

Current rule (line 14897):
```css
.squad-flow-squad {
  display: flex;
  flex-direction: column;
}
```
Replace with:
```css
.squad-flow-squad {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 2: Make `.squad-flow-canvas` fill height (drop the 56vh cap)**

Current rule (line 14954) contains `overflow: auto; max-height: 56vh; min-height: 280px; overscroll-behavior: contain;`. Replace those four height-related lines so the rule reads:
```css
.squad-flow-canvas {
  position: relative;
  margin: 0 24px;
  background-image: radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text-dim) 22%, transparent) 1px, transparent 0);
  background-size: 22px 22px;
  background-attachment: local;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: auto;
  flex: 1;
  min-height: 0;
  overscroll-behavior: contain;
}
```
(Removed: `max-height: 56vh;` and `min-height: 280px;`. Added: `flex: 1;` and `min-height: 0;`. Everything else verbatim.)

- [ ] **Step 3: Add switcher styles**

Immediately AFTER the `.squad-flow-canvas` rule's closing brace (before `.squad-flow-content` at line 14968), insert:

```css
.squad-flow-switcher {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  margin: 0 24px 10px;
  padding-bottom: 2px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  flex: 0 0 auto;
}

.squad-flow-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 5px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-dim);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}

.squad-flow-tab:hover {
  border-color: var(--border-strong);
  color: var(--text);
}

.squad-flow-tab.active {
  border-color: var(--squad-tab-accent, var(--accent-blue));
  color: var(--text);
  box-shadow: inset 0 -2px 0 0 var(--squad-tab-accent, var(--accent-blue));
}

.squad-flow-tab:focus-visible {
  outline: 2px solid var(--accent-blue);
  outline-offset: 2px;
}

.squad-flow-tab-icon {
  font-size: 13px;
}

.squad-flow-tab-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

/* "New" cue: a small accent dot before an unseen, unselected squad's chip. */
.squad-flow-tab--new::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-blue);
  flex: 0 0 auto;
}
```

> Token check: if `--text` is not defined in this codebase, use `--text-primary` (grep `:root` in global.css to confirm the exact token names before pasting; the `squad-flow-node` rules nearby already reference the canonical text token — match it).

- [ ] **Step 4: Typecheck (CSS has no test runtime; verify the app still builds types)**

Run: `npm run typecheck`
Expected: 0 errors (CSS-only change; this just confirms nothing else broke).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/global.css
git commit -m "style(squad-flow): full-height canvas + switcher chip styling"
```

---

### Task 5: Update the CSS regression guard for full-height

The existing guard asserts `max-height: 56vh` — which we deliberately removed. Flip that assertion to guard the new full-height contract, and keep the `overflow: auto` / `.squad-flow-content` guards.

**Files:**
- Modify: `src/renderer/__tests__/squad-flow-scrollable.guard.test.ts` (the third `it(...)` block)

**Interfaces:**
- Consumes: the `extractRule` helper already in the file; the `.squad-flow-canvas` rule from Task 4.
- Produces: nothing.

- [ ] **Step 1: Replace the `max-height` assertion**

In `src/renderer/__tests__/squad-flow-scrollable.guard.test.ts`, replace the third test:

```ts
  it('.squad-flow-canvas has max-height constraint (56vh)', () => {
    // Defensive: ensure the bounded viewport remains in place so the board
    // doesn't vertically stretch to fill the entire window.
    const rule = extractRule(css, '.squad-flow-canvas');
    expect(rule).toMatch(/max-height\s*:\s*56vh/);
  });
```

with:

```ts
  it('.squad-flow-canvas fills its container (flex:1, not capped at 56vh)', () => {
    // The Flow view shows ONE focused squad at a time (see SquadSwitcher), so
    // the canvas should fill the whole board area and scroll internally — NOT
    // be capped to a 56vh slice (the old stacked-squads behavior).
    const rule = extractRule(css, '.squad-flow-canvas');
    expect(rule, 'canvas should flex to fill the board').toMatch(/flex\s*:\s*1/);
    expect(rule, 'must NOT re-cap the canvas at 56vh').not.toMatch(/max-height\s*:\s*56vh/);
  });
```

- [ ] **Step 2: Run the guard**

Run: `npx vitest run src/renderer/__tests__/squad-flow-scrollable.guard.test.ts`
Expected: PASS (3 tests — overflow:auto, content wrapper, full-height).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/__tests__/squad-flow-scrollable.guard.test.ts
git commit -m "test(squad-flow): guard full-height canvas instead of 56vh cap"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all pass, including the new `squadSelection`, `SquadSwitcher`, and updated guard tests. Note the new total (prior baseline was 1532).

- [ ] **Step 3: Manual verification recipe (record in the PR / inbox, don't skip)**

1. Launch 2+ teams in different projects so the Flow view has 2+ squads.
2. Open Agents board → Flow view. Confirm: a switcher chip row appears, one chip per squad, each labelled by **project name** (not a generic "Squad"), with the project color accent and a working-count dot.
3. Confirm the selected squad's graph **fills the whole board area** top-to-bottom (no 56vh slice, no dead space below), and scrolls **internally** when the graph is taller than the area.
4. Click another chip → canvas switches to that squad.
5. Launch a third team → its chip appears (with the "new" dot) but the canvas **stays** on your selected squad (sticky).
6. Let the selected squad exit (close its agents) → selection falls back to the first remaining squad; no blank canvas.
7. Close all but one squad → switcher disappears; the single squad still fills the area.
8. Per-project Agents board (open one project, Flow view): no switcher, single squad fills the area.

- [ ] **Step 4: Push an inbox completion entry**

Summarize the outcome and link the spec + plan via `docs`.

---

## Self-Review

**Spec coverage:**
- Switcher visibility (0/1/2+) → Task 3 (`graphs.length > 1` guard) + Task 4 (styling) ✓
- Project-derived labels (real clarity fix) → Task 3 (`g.squad?.name ?? project?.name`) ✓
- Sticky selection (new doesn't steal, exit-fallback) → Task 1 (`reconcileSquadSelection`) + Task 3 (wiring) ✓
- New-squad cue (bounded, non-persisted, cuttable) → Task 3 (`seenRef`) + Task 4 (`--new::before`) ✓
- Full-height focused squad (drop 56vh, flex:1) → Task 4 (`.squad-flow-canvas` + `.squad-flow-squad`) ✓
- In-memory only (no persistence) → Task 3 (`useState`, `useRef`; no store/IPC) ✓
- Namespace / coupling safety → Task 4 (only `squad-flow-*`; reuses `agent-*` dot) ✓
- Tests: reducer, switcher render, full-height guard → Tasks 1, 2, 5 ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The two token caveats (`--text` vs `--text-primary`; jsdom env line) are explicit verify-then-paste instructions, not placeholders.

**Type consistency:** `reconcileSquadSelection(prev, graphs)` signature identical across Tasks 1 & 3. `SquadSwitcherItem` fields (`projectId/label/icon/color/working/isNew`) identical across Tasks 2 & 3. `SquadSwitcher` props (`items/selected/onSelect`) match the call site in Task 3. `summary.working` matches the `SquadFlowGraph` type. `project.name` / `project.color` match the `Project` type (`color` optional → `color?` in item).
