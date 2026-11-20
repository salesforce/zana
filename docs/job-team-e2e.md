# Team E2E tests

The **Team** launch feature ships THREE owner surfaces that must all start a
durable execution and drive it to `COMPLETED`. When someone says
"run the Job Team E2E tests", run the deterministic suite below.

## The three surfaces (deterministic, always-on, no model spend)

| Surface | Spec | What it drives |
| --- | --- | --- |
| Team UI | `e2e/job-team-launch-ui.spec.ts` | Real composer → structured planning → `teams.startJob` → board |
| CLI Agent owner | `e2e/cli-agent-job-team-run.spec.ts` | Live PTY owner → loopback MCP `execution.start` |
| Modern (ACP) owner | `e2e/modern-owner-job-team-run.spec.ts` | Real ACP owner thread → `/internal/hosts/tool-call` → Modern forwarder → loopback MCP `execution.start` |

Each runs the same generic 4-unit fake DAG: `home` + `about` (parallel) →
durable `navigation-label` blocker (answered "About Atlas" through the Inbox UI)
→ `assemble`, and asserts the project's `result.txt` contains `LABEL: About Atlas`.
No real model is called — the coordinator/workers are a deterministic fake binary
and the Modern owner thread uses the fake `opencode` ACP fixture.

The Squad UI spec runs both planning modes with Claude and Codex cohorts. The
Codex fixture validates the native per-tool approval map, rejects privileged
tool approvals, and consumes each assignment only after its bracketed paste and
separate Return arrive. It also emits disable/enable controls in one output
chunk and exercises working/idle transitions between assignments. Headless
Squad sessions intentionally omit native lifecycle hooks.

`e2e/job-team-plan-correction.spec.ts` covers the Squad plan-correction flow
with the `plan-correction` / `plan-correction-silent` fake-coordinator scenarios:
a defective provided plan (Mutating step, no Write scope) parks the run, Inbox
card 1 "Request changes" wakes the coordinator, which writes
`.zana/execution-plan-corrected-<executionId>.md`; card 2 "Approve" runs the
corrected plan to `COMPLETED`. The silent scenario never writes the file, so the
"finished its turn without writing a corrected plan" card appears and Cancel
ends `STOPPED` with `timeoutReason: plan-correction-cancelled`. The valid-plan
bypass (no card) is covered by `job-team-launch-ui.spec.ts`.

`e2e/job-team-plan-correction-schedule.spec.ts` runs the same two cards for a
scheduled Squad: Approve also persists the corrected plan into the schedule
prompt. Approve is rejected if the schedule was edited during review, or if the
corrected plan no longer matches the approved digest.

`e2e/job-team-plan-correction-goal.spec.ts` does the same for a Squad goal
(`assignment: {kind:'team'}`, `planSource: 'provided'`, `successCriteria: []`,
created via `goals.create` like GoalsPanel): activating it parks on a defective
statement, and Approve rewrites the goal statement to the corrected plan and
completes the same execution. A second case edits the goal statement during
review and expects Approve to fail with "the goal plan was edited". The fake
coordinator writes realistic corrected plans (`Depends on: None.`, write scope
with a trailing period) to cover portable-plan trailing-period parsing.

`e2e/squad-execution-store-ownership.spec.ts` (manual test MT-8) reuses one
isolated HOME across five built-app launches (`ZCC_EXECUTION_STORE=json`, none,
none, `json`, none). Every run is a real `teams.startJob` Squad (provided
`write-note` -> `review-note` plan, fake coordinator) driven to `COMPLETED`; no
record is seeded. After each quit it reads `squad-executions.json` and, via
`createSqliteDatabase` read-only, `squad-executions.sqlite` to prove each run
stays in its creating store, `executionBoard.dismiss` lands only in the owning
store, and a `json` relaunch neither imports nor alters SQLite-owned runs.
Limitation: the `json` relaunch is only a stand-in for a JSON-only reader; this
spec does not run a genuinely older build.

Check the approval arguments against an installed Codex without a model call:

```bash
ZCC_LIVE_CODEX=1 pnpm exec vitest run apps/host-daemon/src/harness/__tests__/codex-mcp-approval.live.test.ts
```

### Run

```bash
# Builds an isolated app and runs the deterministic owner-launch specs.
# Node/Vitest and other Electron runs can continue alongside it.
pnpm run test:e2e:jobteam

# Already built? Snapshot the existing app and run the specs:
pnpm run test:e2e:jobteam:only
```

The `-g "Job Team"` grep also matches all three test titles if you prefer
`playwright test -g "Job Team"` (after a build).

Node and Electron use independent, verified SQLite binaries. The shared Playwright
global setup prepares private app/native copies and unique artifacts, including
for direct `playwright test` calls. No shared ABI switching or restore is needed.
See [native runtime isolation](native-runtime-isolation.md).

### Test-only launch fault

To prove that a launch whose final lifecycle write fails leaves no live session, an E2E
build can force that write to throw. The seam is compiled out of every other build:

- `__ZCC_TEST_FAULTS__` is inlined by `electron.vite.config.ts` as `true` only when
  `ZCC_E2E_BUILD=1` (set by `pnpm test:e2e` and `pnpm test:e2e:jobteam`). Production
  builds get `false`, so the branch is removed and the variable is never read.
- Even in an E2E build nothing happens unless the app is launched with
  `ZCC_TEST_FAULT=launch-complete-throw`. It is off by default.
- Effect: `launchTeam` throws just before `teamLifecycle.complete`. Every session the
  request started must then be closed by id, run seats released and the launch request
  cancelled; the original error is returned to the caller.

Run the fault specs with `pnpm test:e2e -- <spec>` (or `test:e2e:jobteam`), never
`:only` against a production build: `:only` snapshots an existing build whose fault seam
is compiled out, so the specs would fail for the wrong reason.

`ZCC_TEST_FAULT=worker-spawn-throw` (same gating) makes the second seat of each
persona row (slot id ending `:1`) throw instead of spawning, so a failed worker slot is
reachable without a broken binary. Observed `launch-complete-throw` outcome: the caller
gets `TEAM_LAUNCH_STATE_CONFLICT`, no sessions remain, and the run ends BLOCKED.
The seat predicate lives in `apps/desktop/src/test-faults.ts` (`workerSpawnFaultFor`) and is
unit-tested there.

`ZCC_TEST_NO_TURN_WARN_MS=<ms>` (same gating, 1 ms to 10 minutes) overrides the no-turn
warning window (`testNoTurnWarnWindowMs`, wired to the execution service's
`noTurnWarnWindowMs` in `host.ts`), so a spec need not wait the production stall window.

### Worker-lifecycle specs

All registered in `JOBTEAM_SPECS` in `scripts/run-jobteam-e2e.mjs`:

| Spec | Covers |
| --- | --- |
| `e2e/job-team-cli-plan-input.spec.ts` | `zcc team launch --dry-run --plan-file` with a plan over 8192 bytes, plus bad/missing/oversize/freeform errors and exit codes. Runs the built CLI from a main-owned shell PTY, so run `pnpm build:cli` first; the session env vars are unset in the script. |
| `e2e/job-team-failed-slots.spec.ts` | Structured run fails with the slot reason; freeform run warns and the board card keeps a failed-slot row with the reason; an all-unresolved roster is refused at admission (`worker-spawn-throw`). |
| `e2e/job-team-launch-complete-fault.spec.ts` | `launch-complete-throw` leaves no live session. |
| `e2e/job-team-worker-exit.spec.ts` | An exited worker stays on its nested run card, raises a board event and Inbox row, then Stop and run Dismiss clear it. The standalone retained card applies only to non-run workers. |
| `e2e/job-team-worker-respawn.spec.ts` | Coordinator `execution.worker.respawn`: two respawns succeed, the third is refused (cap 2 per slot). |
| `e2e/job-team-worker-restart.spec.ts` | Card Restart rejoins the Squad; orchestrator and unknown ids are refused. |
| `e2e/job-team-run-limits.spec.ts` | Per-Squad run limits reach run detail (including a scheduled run of the saved Squad); `maxConcurrent` counts coordinator plus workers and refuses a roster over the cap. |
| `e2e/job-team-no-turn-warning.spec.ts` | A claimed worker with no turn raises exactly one `worker-no-turn` run warning and one Inbox row (`ZCC_TEST_NO_TURN_WARN_MS`). |
| `e2e/squad-settings-surfaces.spec.ts` | Persona load warnings, Settings Launch opens a pre-filled New Agent dialog without creating tabs, foreign ids refused. |

Harness notes (`e2e/sdk/harness.ts`): the `respawn-after-kill` scenario polls
`.e2e-respawn.json` in the coordinator's cwd and calls `execution.worker.respawn` for
each slot id listed; results are logged as `respawn[<slotId>] <json>` in
`.fake-coordinator.log`. Respawn needs a RUNNING run, so use at least two workers: a
sole worker that dies leaves the run BLOCKED. Drop malformed persona files after
launch and reload; creating one before launch coincided with `personas:save` not being
registered.

## Live coverage

These deterministic specs prove the full plumbing with no model spend. A real
OpenCode/Claude model actually reaching the tool is exercised separately, out of
this tree, by the owner of the integration (core stays unaware of it by design).
