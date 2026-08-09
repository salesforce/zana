# Unify Persona/Team Systems by Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "Squad" picker from the agent launcher so each UI context speaks one agent-launching vocabulary — Launcher = ZCC Personas + Teams, Tickets = Zana Profiles — after first taking a verbatim backup of the user's `~/.zana` profiles/teams.

**Architecture:** Delete the read-only daemon-team lister (`listSquads`) and its full IPC producer chain (`squads:list` channel → main handler → preload bridge → `window.cc` type declaration), then strip the Squad picker UI + `/zana:team`-seeding branch from `LaunchPanel`. The `SquadSummary` type and the Squad Flow runtime view (`squadFlow.ts`, `SquadFlowGraph.squad?`) are shared and stay. Nothing under `~/.zana` is modified; `/zana:team <id>` remains reachable by typing it into the launcher prompt.

**Tech Stack:** Electron + React + TypeScript, Vitest for unit tests, `electron-vite dev` for the dev app.

## Global Constraints

- **Rule 1 — renderer untrusted, main authorizes.** No change may move a trust decision into the renderer. (This plan only *removes* a renderer-triggered read; it adds no new authority.)
- **Rule 6 — core never names a specific extension in logic.** Do not introduce any literal `'zana'` module-id in core logic. (This plan removes code; do not add such literals.)
- **Do NOT touch the Squad Flow runtime view.** `src/renderer/util/squadFlow.ts`, `src/renderer/util/squadLaunchGroups.ts`, `src/renderer/components/SquadFlowView.tsx`, `src/renderer/components/SquadSwitcher.tsx`, and their tests (`SquadSwitcher.test.tsx`, `squad-flow-scrollable.guard.test.ts`, `squadFlow.test.ts`) are a different subsystem and stay exactly as-is.
- **Keep the `SquadSummary` interface** (`src/shared/types.ts:1970`) and the **`SquadFlowGraph.squad?: SquadSummary`** field (`src/shared/types.ts:2113`) — both belong to the Squad Flow view. Only the `window.cc.squads` API declaration is removed.
- **Nothing under `~/.zana` is modified or deleted.** The backup is a copy, not a move.
- **Backup date is `2026-07-09`** (today). Destination dir: `~/.zcc/backups/zana-2026-07-09/`.
- Test command: `npm test` (vitest run). Typecheck: `npm run typecheck`. Dev app: `npm run dev`.

---

### Task 1: Back up the user's Zana profiles & teams (verbatim, insurance)

This runs first so the safety copy exists before any deletion. It is a one-time shell operation over the user's home dir (not source code), so it carries no unit test — its deliverable is verified by listing the copied files.

**Files:**
- Create: `~/.zcc/backups/zana-2026-07-09/profiles/*.json` (copies)
- Create: `~/.zcc/backups/zana-2026-07-09/teams/*.json` (copies)
- Create: `~/.zcc/backups/zana-2026-07-09/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks (pure insurance, independent).

- [ ] **Step 1: Create the backup directories**

```bash
mkdir -p ~/.zcc/backups/zana-2026-07-09/profiles ~/.zcc/backups/zana-2026-07-09/teams
```

- [ ] **Step 2: Copy the profiles and teams verbatim (byte-for-byte, includes any `.seeded` marker)**

```bash
cp -p ~/.zana/profiles/*.json ~/.zcc/backups/zana-2026-07-09/profiles/
cp -pR ~/.zana/teams/. ~/.zcc/backups/zana-2026-07-09/teams/
```

- [ ] **Step 3: Verify the copy count (expect 6 profiles, 10 team JSON files)**

Run:
```bash
echo "profiles: $(ls ~/.zcc/backups/zana-2026-07-09/profiles/*.json | wc -l | tr -d ' ')"
echo "teams:    $(ls ~/.zcc/backups/zana-2026-07-09/teams/*.json | wc -l | tr -d ' ')"
```
Expected:
```
profiles: 6
teams:    10
```

- [ ] **Step 4: Confirm the source is untouched (same counts still present under ~/.zana)**

Run:
```bash
echo "src profiles: $(ls ~/.zana/profiles/*.json | wc -l | tr -d ' ')"
echo "src teams:    $(ls ~/.zana/teams/*.json | wc -l | tr -d ' ')"
```
Expected:
```
src profiles: 6
src teams:    10
```

- [ ] **Step 5: Write the backup README**

Write `~/.zcc/backups/zana-2026-07-09/README.md` with this exact content:

```markdown
# Zana profiles/teams backup — 2026-07-09

Verbatim safety copy of the user's Zana daemon data, taken before removing the
"Squad" picker from the Zana Command Center launcher.

- `profiles/` — copies of `~/.zana/profiles/*.json` (6 files)
- `teams/`    — copies of `~/.zana/teams/*.json` (10 files)

**This is a COPY, not a move.** Nothing under `~/.zana` was modified or deleted.
The live files remain in place, and the `/zana:team <id>` slash command still
resolves against `~/.zana/teams`. Type `/zana:team <id>` into the launcher prompt
to run a daemon squad exactly as before.

No functional import into `~/.zcc` was performed: the `~/.zcc/teams` counterparts
that share these ids are newer, hand-tuned, and use a different schema (persona
slug refs vs profile UUID refs). These JSON files are kept only as reference if
the user later wants to hand-craft ZCC equivalents.
```

- [ ] **Step 6: Verify the README exists**

Run: `test -f ~/.zcc/backups/zana-2026-07-09/README.md && echo OK`
Expected: `OK`

*(No commit — this task writes only to `~/.zcc` / `~/.zana` outside the repo, nothing to stage.)*

---

### Task 2: Delete the daemon-team store and its unit test

**Files:**
- Delete: `src/main/daemon-team-store.ts`
- Delete: `src/main/__tests__/daemon-team-store.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: removes the `listSquads(): SquadSummary[]` export. Task 3 removes its last importer (`src/main/index.ts`), so this task will leave a temporarily-broken import until Task 3 lands; they are committed together conceptually but split for reviewability — run the build only after Task 3.

- [ ] **Step 1: Delete the store and its test**

```bash
git rm src/main/daemon-team-store.ts src/main/__tests__/daemon-team-store.test.ts
```

- [ ] **Step 2: Confirm no test file remains that imports the deleted store**

Run: `grep -rln "daemon-team-store" src/ || echo "no importers except index.ts (removed in Task 3)"`
Expected: only `src/main/index.ts` appears (its import is removed next task), or the fallback line.

*(No commit yet — commit together with Task 3, which removes the now-dangling import. Committing here alone would leave `index.ts` referencing a deleted module.)*

---

### Task 3: Remove the `squads:list` IPC producer chain

Removes the four coupled sites that declare, register, bridge, and type the `squads:list` channel. After this task the project builds again (Task 2's deletion has no remaining importer).

**Files:**
- Modify: `src/main/index.ts:121` (remove import), `src/main/index.ts:3960-3962` (remove handler + its comment)
- Modify: `src/shared/ipc.ts:422-425` (remove `squads` channel + its comment)
- Modify: `src/preload/index.ts:278-280` (remove `squads` bridge)
- Modify: `src/shared/types.ts:3866-3876` (remove `squads` API declaration + its doc comment)

**Interfaces:**
- Consumes: the deletion from Task 2 (`listSquads` no longer exists).
- Produces: `window.cc.squads` no longer exists on the bridge type — Task 4 (LaunchPanel) must stop calling `window.cc.squads.list()`.

- [ ] **Step 1: Remove the `listSquads` import in main**

In `src/main/index.ts`, delete this line (line 121):

```ts
import { listSquads } from './daemon-team-store.js';
```

- [ ] **Step 2: Remove the `squads:list` IPC handler in main**

In `src/main/index.ts`, delete these three lines (3960-3962):

```ts
  // Daemon teams ("squads") — read-only listing of ~/.zana/teams for the
  // launcher's squad picker. Failure (missing dir, unreadable files) → [].
  safeHandle(IPC.squads.list, () => listSquads(), () => []);
```

(Leave the preceding `safeHandle(IPC.teams.list, …)` and the following `safeHandle(IPC.teams.revealDir, …)` intact.)

- [ ] **Step 3: Remove the `squads` channel in the IPC map**

In `src/shared/ipc.ts`, delete these four lines (422-425):

```ts
  /** Zana daemon teams (read-only) — the registry `/zana:team` resolves against. */
  squads: {
    list: 'squads:list'
  },
```

(Leave the `teams: { … }` block above and the `autonomousRuns: { … }` block below intact.)

- [ ] **Step 4: Remove the `squads` preload bridge**

In `src/preload/index.ts`, delete these three lines (278-280):

```ts
  squads: {
    list: () => ipcRenderer.invoke(IPC.squads.list)
  },
```

(Leave the `teams: { … }` object above — including its closing `},` on line 277 — and the `autonomousRuns: { … }` object below intact.)

- [ ] **Step 5: Remove the `squads` API declaration in the bridge type**

In `src/shared/types.ts`, delete these eleven lines (3866-3876) — the doc comment plus the `squads` member:

```ts
  /**
   * Zana *daemon* teams ("squads"), read-only — the `~/.zana/teams` registry the
   * `/zana:team` slash command resolves against. DISTINCT from `teams` above:
   * picking a squad seeds ONE agent with `/zana:team <id>` so it orchestrates the
   * roster in-session, rather than opening a tab per slot. The launcher lists
   * these so the user can launch an agent that runs a whole squad.
   */
  squads: {
    list(): Promise<SquadSummary[]>;
  };
```

(This leaves `SquadSummary` (line 1970) and `SquadFlowGraph.squad?` (line 2113) in place — they are used by the Squad Flow view. Do NOT remove them.)

- [ ] **Step 6: Verify no `squads:list` / `squads.list` / `listSquads` references remain**

Run:
```bash
grep -rn "squads:list\|squads\.list\|listSquads\|\.squads\b\|daemon-team-store" src/
```
Expected: no output (empty). `SquadSummary` and `SquadFlowGraph.squad` still exist but are NOT matched by this grep.

- [ ] **Step 7: Typecheck (LaunchPanel still references `window.cc.squads` — expect an error there only)**

Run: `npm run typecheck`
Expected: FAIL, with errors pointing only at `src/renderer/components/LaunchPanel.tsx` (its `window.cc.squads.list()` call and `SquadSummary` usage). This confirms the producer chain is fully gone and isolates the remaining consumer for Task 4. No errors in `index.ts`, `ipc.ts`, `preload/index.ts`, or `types.ts`.

*(No commit yet — the tree does not typecheck until Task 4 removes the consumer. Commit at the end of Task 4 covers Tasks 2–4 together.)*

---

### Task 4: Remove the Squad picker from LaunchPanel

Strips every squad-related bit of `LaunchPanel.tsx`: the `SquadSummary` import, the `squads`/`squadId`/`squadsCollapsed` state, the `squads.list()` effect, `selectedSquad`, the `/zana:team` seeding branch in `launch()`, the Squad picker JSX block, and the squad hint. Also trims the `LaunchSectionLabel` doc comment.

**Files:**
- Modify: `src/renderer/components/LaunchPanel.tsx` (see steps for exact lines)

**Interfaces:**
- Consumes: the removal of `window.cc.squads` (Task 3) — this task removes its only caller.
- Produces: a launcher whose `launch()` seeds only the typed prompt; no downstream task depends on it.

- [ ] **Step 1: Remove the `SquadSummary` import**

In `src/renderer/components/LaunchPanel.tsx`, in the `import type { … } from '@shared/types';` block (lines 3-9), remove the `SquadSummary,` line so the block reads:

```tsx
import type {
  ClaudeSessionSummary,
  LaunchProfileId,
  Project,
  TerminalSession
} from '@shared/types';
```

- [ ] **Step 2: Trim the `LaunchSectionLabel` doc comment**

The component's doc comment (lines 15-22) mentions "Persona / Squad" and "personas/squads". Replace the comment block with:

```tsx
/**
 * A collapsible header for the launcher's Persona picker row. Reuses the rail's
 * `collapsedSections` store + `list-section-chevron` rotation so the collapse
 * state persists across opens. When collapsed it shows a short summary (the
 * selected item's name, or the item count) so the row stays informative without
 * expanding — keeping the tall picker list from crowding out the Send button
 * when there are many personas.
 */
```

- [ ] **Step 3: Remove the `squads` and `squadId` state + their comment**

Delete lines 121-126 (the comment block plus the two `useState` calls):

```tsx
  // Optional squad selection. null = launch a single agent (today's behavior).
  // Picking a squad seeds the agent's first prompt with `/zana:team <id>` so the
  // one agent orchestrates that Zana daemon team in-session. Squads are listed
  // read-only from ~/.zana/teams (the registry `/zana:team` resolves against).
  const [squads, setSquads] = useState<SquadSummary[]>([]);
  const [squadId, setSquadId] = useState<string | null>(null);
```

Leave the `personaId` state above (line 120) and the `mode`/`teamId` state below intact.

- [ ] **Step 4: Remove the `squadsCollapsed` selector and trim the collapse comment**

Replace the collapse-state comment + both selectors (lines 132-136):

```tsx
  // Collapse state for the (potentially long) Persona / Squad picker rows, read
  // from the shared rail store so it persists across opens. Collapsed rows drop
  // out of the layout so the Send button stays reachable without scrolling.
  const personasCollapsed = useUi((s) => !!s.collapsedSections['launch:personas']);
  const squadsCollapsed = useUi((s) => !!s.collapsedSections['launch:squads']);
```

with (drop the `squadsCollapsed` line and de-pluralize the comment):

```tsx
  // Collapse state for the (potentially long) Persona picker row, read from the
  // shared rail store so it persists across opens. A collapsed row drops out of
  // the layout so the Send button stays reachable without scrolling.
  const personasCollapsed = useUi((s) => !!s.collapsedSections['launch:personas']);
```

- [ ] **Step 5: Remove the `squads.list()` effect**

Delete the one-shot daemon-squads loader (lines 170-186):

```tsx
  // One-shot load of the daemon squads for the picker. Read-only; empty on any
  // failure (the picker row just stays hidden). No live subscription — the list
  // changes rarely and a fresh launcher reads it again.
  useEffect(() => {
    let alive = true;
    void window.cc.squads
      .list()
      .then((list) => {
        if (alive) setSquads(list);
      })
      .catch(() => {
        /* leave squads empty — picker row hides itself */
      });
    return () => {
      alive = false;
    };
  }, []);
```

- [ ] **Step 6: Remove the `selectedSquad` derivation**

Delete line 188:

```tsx
  const selectedSquad = squadId ? squads.find((s) => s.id === squadId) ?? null : null;
```

- [ ] **Step 7: Simplify `launch()` to seed only the typed prompt**

In `launch()`, replace the squad-aware body/title logic. The current body (lines 195-222) computes `body` from `selectedSquad` and branches `title` on `selectedSquad`. Replace that whole block — from `const extraArgs: string[] = [];` through the `const title = …` assignment (inclusive) — so it reads:

```tsx
    const extraArgs: string[] = [];
    const typed = prompt.trim();
    // Seed the typed prompt as the LAST positional argv element — `claude
    // [options] [prompt]` picks it up as the first user turn (same mechanism the
    // scheduler uses, see scheduler.ts).
    // A prompt that begins with a dash would otherwise be parsed as a flag, so
    // we precede it with `--` (end-of-options) to force it to be treated as the
    // positional prompt.
    if (typed) {
      if (typed.startsWith('-')) extraArgs.push('--');
      extraArgs.push(typed);
    }
    // A persona's base profile (if it declares one) wins over the segmented
    // choice; otherwise the persona layers onto the selected profile. The main
    // process re-resolves this, but we pass the best base so the title/icon match.
    const baseProfile = selectedPersona?.baseProfile ?? descriptor.profile;
    const title = typed
      ? titleFromPrompt(typed)
      : selectedPersona?.name ?? descriptor.label;
```

(The `onLaunch(baseProfile, { … })` call and `onClose?.()` below it stay unchanged.)

- [ ] **Step 8: Remove the Squad picker JSX block**

Delete the entire squad picker block (lines 390-430) — from `{mode === 'agent' && squads.length > 0 && (` through its closing `)}`. It sits between the Persona picker block (ends line 388) and the squad hint (line 432). After deletion, the Persona block is immediately followed by the (now-also-removed, next step) hint / the `launch-actions` div.

- [ ] **Step 9: Remove the squad hint**

Delete the squad hint block (lines 432-439):

```tsx
      {mode === 'agent' && !squadsCollapsed && selectedSquad && (
        <p className="launch-squad-hint">
          Launches one agent running <code>/zana:team {selectedSquad.id}</code> — it
          orchestrates {selectedSquad.workerCount} worker
          {selectedSquad.workerCount === 1 ? '' : 's'} in-session. Your text below
          becomes the squad's task.
        </p>
      )}
```

(The autonomous-team "No teams configured" hint also uses `launch-squad-hint` at line 277 — leave that one; only this `selectedSquad` block is removed.)

- [ ] **Step 10: Verify no squad references remain in LaunchPanel**

Run:
```bash
grep -n "squad\|Squad" src/renderer/components/LaunchPanel.tsx
```
Expected: **exactly one** match — the autonomous-team "No teams configured" hint on the `<span className="launch-squad-hint">` line (that CSS class is shared and stays). Confirm there are NO matches for `SquadSummary`, `squadId`, `selectedSquad`, `squads`, `squadsCollapsed`, or `window.cc.squads`:

```bash
grep -n "SquadSummary\|squadId\|selectedSquad\|\bsquads\b\|squadsCollapsed\|cc\.squads" src/renderer/components/LaunchPanel.tsx || echo "clean"
```
Expected: `clean`.

- [ ] **Step 11: Typecheck the whole project**

Run: `npm run typecheck`
Expected: PASS (no errors). Confirms Tasks 3 + 4 left the tree consistent.

- [ ] **Step 12: Run the test suite**

Run: `npm test`
Expected: PASS. `daemon-team-store.test.ts` is gone; `squadFlow.test.ts`, `SquadSwitcher.test.tsx`, and `squad-flow-scrollable.guard.test.ts` (Squad Flow view) still pass unchanged.

- [ ] **Step 13: Commit Tasks 2–4 together**

Stage ONLY the files this work touched (the tree has unrelated WIP that must stay uncommitted — do NOT use `git add -A`). Task 2's `git rm` already staged the two deletions; this adds the five modified files:

```bash
git add src/main/index.ts src/shared/ipc.ts src/preload/index.ts src/shared/types.ts src/renderer/components/LaunchPanel.tsx
git status --short   # confirm ONLY the 2 deletions + 5 modifications are staged; unrelated WIP stays unstaged
git commit -m "feat: remove Squad picker from launcher (one vocabulary per context)

Drops the ~/.zana daemon-team ('squad') picker + its full IPC producer chain
(listSquads store, squads:list channel, preload bridge, window.cc.squads type).
The launcher is now ZCC-only (Personas + Teams); Zana Profiles stay in Tickets.
The SquadSummary type and the Squad Flow runtime view are untouched, and
/zana:team <id> still works by typing it into the prompt."
```

---

### Task 5: Verify in the dev app

Confirms end-to-end behavior — not just tests. Manual verification; no code changes.

**Files:** none.

**Interfaces:**
- Consumes: the committed changes from Tasks 2–4 and the backup from Task 1.
- Produces: nothing.

- [ ] **Step 1: Launch the dev app**

Run: `npm run dev`
Expected: the app boots with no errors in the main-process console.

- [ ] **Step 2: Open "New agent" and inspect the launcher**

In any project, click "New agent". Confirm the modal shows: the Single agent / Autonomous team mode toggle, the Profile segmented control, and the **Persona** picker. Confirm there is **no "Squad" row** and **no squad hint**.

- [ ] **Step 3: Confirm no `squads:list` IPC error**

Check the dev console (both main and renderer). Expected: no `No handler registered for 'squads:list'` error and no rejected `window.cc.squads` call (the renderer no longer references it).

- [ ] **Step 4: Spot-check the `/zana:team` escape hatch (soft gate)**

Type `/zana:team core-dev-squad` into the launcher prompt and launch a single agent. Expected: the agent starts with that slash command as its first turn (the slash-command path is unchanged). This is a spot check, not a hard gate — if the daemon isn't running the command may no-op, which is fine.

- [ ] **Step 5: Confirm the backup exists**

Run:
```bash
ls ~/.zcc/backups/zana-2026-07-09/profiles/*.json | wc -l
ls ~/.zcc/backups/zana-2026-07-09/teams/*.json | wc -l
test -f ~/.zcc/backups/zana-2026-07-09/README.md && echo "README OK"
```
Expected: `6`, `10`, `README OK`.

- [ ] **Step 6: Stop the dev app**

Quit the dev app (Cmd-Q or close the window). No commit — verification only.
