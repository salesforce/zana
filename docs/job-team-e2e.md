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
