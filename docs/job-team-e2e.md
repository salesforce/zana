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

## Live coverage

These deterministic specs prove the full plumbing with no model spend. A real
OpenCode/Claude model actually reaching the tool is exercised separately, out of
this tree, by the owner of the integration (core stays unaware of it by design).
