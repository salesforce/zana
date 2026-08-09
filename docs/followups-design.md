# Follow-ups — design & implementation plan

A **Follow-up** is a small, persisted record an agent leaves behind when it reaches
an idle state with a pending question or decision (*"Do you want me to commit?"*,
*"Which approach should I take?"*) — instead of silently blocking on human review.
The user clears it in their own time; the agent can keep working or close out.

This is the feature the project brief called "Tasks". After a terminology pass
with the engineering review (see *Terminology* below) we settled on **Follow-up**.

## Why a new concept (not a ticket, not a goal)

The app already has two work-tracking concepts; Follow-ups is deliberately the
*lightest* of the three and owns a niche neither covers.

| | **Ticket** (zana / external orchestrator) | **Goal** (ZCC-native) | **Follow-up** (this feature) |
|---|---|---|---|
| Owner | External orchestrator | ZCC main process | ZCC main process |
| Origin | User / orchestrator files it | User / agent defines an objective | **Agent emits it on hitting idle** |
| Shape | Unit of work to *do* | Autonomous loop toward a criterion | A *question/decision* parked for the human |
| Lifecycle | backlog → in-progress → done | draft→active→achieved/exhausted/… | **open → resolved / dismissed** |
| Has a loop? | No | Yes (spawn → evaluate → re-spawn) | No — inert until a human acts |
| Persistence | `.zana/tickets/` (external) | `.zcc/goals/` | `.zcc/followups/` |
| Spends tokens after creation | n/a | Yes, each iteration | **No** — it's just a note |

A ticket is *work to do*; a goal is *an objective the app drives autonomously*; a
follow-up is *a question waiting on you*. Today an idle agent with a pending
question shows a red "Needs you" dot on the Agents board (via the idle-triage
`awaiting-reply` verdict) — but that signal is **ephemeral**: it vanishes the
moment the agent is killed or the app restarts, and there's no record of *what*
it was asking. Follow-ups make that durable.

## Terminology

Considered: **Task**, **Postit**, **Follow-up**, **Note**.

- *Task* — rejected: collides with Claude Code's own `TaskCreate`/`TaskList`
  tools and reads too much like a zana ticket.
- *Postit* / *Note* — too generic; doesn't convey "needs a human decision".
- **Follow-up** — chosen. Conveys "come back to this" precisely; reads naturally
  in the UI ("3 follow-ups") and in agent-facing tool prose ("file a follow-up").

Code identifier: `FollowUp` (type), `followUp` (var), `followups` (collection /
IPC namespace / tab id), `followup_*` (MCP tools). Directory: `.zcc/followups/`.

## Data model

Persisted as one JSON file per record, atomic tmp+rename (CLAUDE.md rule 4):

- `~/.zcc/followups/<id>.json` (global), or
- `<project.path>/.zcc/followups/<id>.json` (per-project, default).

```ts
type FollowUpStatus = 'open' | 'resolved' | 'dismissed';

// Where the record came from — drives the icon/label and lets us dedup.
type FollowUpKind =
  | 'question'    // agent asked something and is waiting (the common case)
  | 'decision'    // agent wants a go/no-go (commit? merge? deploy?)
  | 'note';       // a manual / informational follow-up (no agent waiting)

// How it was created — provenance, host-stamped, never from agent free-text.
type FollowUpOrigin =
  | { source: 'idle-triage'; sessionId: string; confidence?: number }
  | { source: 'agent'; sessionId: string }   // via followup_create MCP tool
  | { source: 'user' };                       // hand-created in the UI

interface FollowUp {
  id: string;                 // uuid
  projectId: string;          // FK into projects.json
  title: string;              // one-line: the question/decision itself
  detail?: string;            // optional longer body (markdown)
  kind: FollowUpKind;
  status: FollowUpStatus;
  origin: FollowUpOrigin;
  /** The pty session that prompted this, if any — lets the UI deep-link to the
   *  agent tab so the user can answer in context. Cleared semantics: the session
   *  may be long gone; the link is best-effort. */
  sessionId?: string;
  /** Free-text resolution the user (or agent) recorded on close. */
  resolution?: string;
  createdAt: string;          // ISO-8601
  updatedAt: string;
  resolvedAt?: string;        // set when status leaves 'open'
  source?: 'global' | { projectId: string };  // loader-only; not persisted
}
```

### Status lifecycle

```
            ┌─────────── user resolves (with optional note)
            │            agent calls followup_resolve
   (create) ▼
  ── open ──┼─────────── user dismisses ───────────► dismissed (terminal)
            │
            └─────────── resolved (terminal)
```

- **open** — created, waiting on a human. The only non-terminal state.
- **resolved** — the question was answered / the decision was made. Terminal.
- **dismissed** — no longer relevant (stale, obsoleted, answered elsewhere). Terminal.

A terminal follow-up can be **reopened** (`setStatus('open')`) if it resurfaces.
Terminal records are retained (not auto-deleted) so there's a history; the user
deletes them explicitly. A per-project retention cap (default 200, CLAUDE.md
rule 5) evicts the oldest *terminal* records when exceeded — open ones are never
auto-evicted.

## Creation flow

Three entry points, all converging on `FollowUpManager.create()`:

1. **Automatic, from idle-triage (the headline feature).** The existing
   `IdleTriageService` already classifies why an agent is idle and emits an
   `IdleTriageResult` with `resolution: 'awaiting-reply'` and a ≤80-char
   `summary`. We add a listener in `index.ts` (next to the existing
   `idleTriage.on('triage', …)`): when `resolution === 'awaiting-reply'`, call
   `followups.createFromIdle(result, session)`. The manager **dedups on
   `(sessionId, kind)`** so a steady idle agent yields exactly one open
   follow-up, refreshed (not duplicated) on each re-triage — mirroring the
   inbox's `dedupeKey` idiom. This reuses idle-triage's existing cost discipline
   (one micro-call per idle spell, dwell-gated); **no new LLM spend**.
   - Gated by a config flag `followupsFromIdle` (default ON when
     `idleTriageEnabled` is on — the verdict is already being computed).
   - Background/scheduled/headless sessions never create follow-ups (same rule
     idle-triage already enforces — they must not request attention).

2. **Explicit, from the agent.** The `followup_create` MCP tool lets an agent
   deliberately park a question (*"I've finished the refactor but I'm unsure
   whether to also bump the version — leaving a follow-up"*). Project-locked via
   the URL route exactly like `goal_create`. `followup_list` / `followup_resolve`
   round out the set so an agent can see and close its own follow-ups.

3. **Manual, from the user.** A "New follow-up" button in the Follow-ups tab —
   a plain reminder/note (`kind: 'note'`, `origin: { source: 'user' }`).

## Interaction with agent idle states

The current idle/triage chain (from review of `agent-status.ts`,
`idle-triage.ts`, `AgentBoard.tsx`):

```
PTY OSC title / notify hook
   → AgentStatusTracker fuses → state ∈ {working, idle, blocked}
   → on 'status' edge into idle: IdleTriageService arms a dwell timer
   → dwell elapses & still idle → builtin:idle-triage micro-call
   → emits IdleTriageResult { resolution, summary, confidence }
   → renderer: AgentBoard promotes 'awaiting-reply' cards to "Needs you"
```

Follow-ups **tap the same `triage` event** without changing any of it:

```
   idleTriage.on('triage', result):
       safeSend(onIdleTriage, result)              // existing — drives the badge
       if result.resolution === 'awaiting-reply':  // NEW
           followups.createFromIdle(result, session)
```

So the ephemeral "Needs you" dot and the durable Follow-up are produced from one
signal: the dot is the *live* cue, the follow-up is the *persistent* record that
survives a kill/restart. When the agent leaves idle and the question is moot, the
follow-up stays open (the human still chose not to answer) — but a later
`followup_resolve` from the agent, or the user dismissing it, closes the loop.

`blocked` agents (a real permission prompt) are **not** turned into follow-ups:
those are genuinely blocking and already handled by the live prompt — a
follow-up is for the *non-blocking* "I paused to ask" case.

## Architecture (mirrors the Goals vertical slice)

| Layer | File | Pattern source |
|---|---|---|
| Types | `src/shared/types.ts` | `Goal` block |
| IPC channels | `src/shared/ipc.ts` | `IPC.goals` |
| CcApi | `src/shared/types.ts` (CcApi) | `CcApi.goals` |
| Persistence | `src/main/followup-store.ts` | `goal-store.ts` (atomic write, validate, listAll) |
| Lifecycle | `src/main/followup-manager.ts` | `goal-manager.ts` (minus the spawn loop) |
| MCP tools | `src/main/followup-mcp-tools.ts` | `goal-mcp-tools.ts` |
| MCP registration | `src/main/mcp-server.ts` | `registerGoalTools` seam |
| Main wiring | `src/main/index.ts` | goals deps + IPC handlers + triage listener |
| Preload | `src/preload/index.ts` | `api.goals` |
| Store | `src/renderer/store.ts` | `useGoals` + count hook |
| Panel | `src/renderer/components/FollowUpsPanel.tsx` | `GoalsPanel.tsx` (dual-mode) |
| Project view | `src/renderer/components/ProjectFollowUpsView.tsx` | `ProjectGoalsView.tsx` |
| Nav | `ProjectScopedNav.tsx` + `Workspace.tsx` | goals tab |
| CSS | reuse `scheduler-*` classes | GoalsPanel reuse |

## Implementation plan (ordered, with dependencies)

1. **Types** (`shared/types.ts`, `shared/ipc.ts`) — no deps. Defines the contract
   every other layer imports. Add `FollowUp*` interfaces, `CcApi.followups`,
   `IPC.followups`, `WorkspaceMode |= 'followups'`, config flag `followupsFromIdle`.
2. **followup-store.ts** — deps: types. Pure FS module, unit-testable in isolation.
3. **followup-manager.ts** — deps: store, types. The lifecycle + dedup brain;
   `createFromIdle()` is the idle integration point. Unit-testable with injected deps.
4. **followup-mcp-tools.ts** — deps: types + a `FollowUpAgentApi` slice. Registered
   in `mcp-server.ts` behind a `followupAgentApi` dep (absent ⇒ not registered).
5. **Main wiring** (`index.ts`, `preload`) — deps: 2-4. Instantiate the manager at
   app init (rule 3, *not* in createWindow), wire IPC handlers + `onChanged`
   broadcast, add the `idleTriage.on('triage')` branch, expose `window.cc.followups`.
6. **Renderer** (`store.ts`, `FollowUpsPanel.tsx`, `ProjectFollowUpsView.tsx`,
   `ProjectScopedNav.tsx`, `Workspace.tsx`) — deps: 1, 5. The tab + live list +
   open-count badge.
7. **Tests + verification** — deps: all. `followup-store.test.ts`,
   `followup-manager.test.ts` (dedup + lifecycle), `followup-mcp-tools.test.ts`;
   `tsc --noEmit` clean; Rule-6 guard still green; simulate an `awaiting-reply`
   triage and assert a follow-up is created (acceptance criterion: integration
   tested against an agent idle scenario).

## Acceptance criteria mapping

- **Clear naming** → *Terminology* (Follow-up).
- **Documented data model + status states** → *Data model* + *Status lifecycle*.
- **Step-by-step plan with dependencies** → *Implementation plan*.
- **Prototype / working implementation** → steps 2-6.
- **Integration tested with ≥1 agent idle scenario** → step 7 (createFromIdle test).
