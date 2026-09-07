# Job Team E2E tests

The **Job Team** launch feature ships THREE owner surfaces that must all start a
durable structured execution and drive it to `COMPLETED`. When someone says
"run the Job Team E2E tests", run the deterministic suite below.

## The three surfaces (deterministic, always-on, no model spend)

| Surface | Spec | What it drives |
| --- | --- | --- |
| Job Team UI | `e2e/job-team-launch-ui.spec.ts` | Real composer → `teams.startJob` → board |
| CLI Agent owner | `e2e/cli-agent-job-team-run.spec.ts` | Live PTY owner → loopback MCP `execution.start` |
| Modern (ACP) owner | `e2e/modern-owner-job-team-run.spec.ts` | Real ACP owner thread → `/internal/hosts/tool-call` → Modern forwarder → loopback MCP `execution.start` |

Each runs the same generic 4-unit fake DAG: `home` + `about` (parallel) →
durable `navigation-label` blocker (answered "About Atlas" through the Inbox UI)
→ `assemble`, and asserts the project's `result.txt` contains `LABEL: About Atlas`.
No real model is called — the coordinator/workers are a deterministic fake binary
and the Modern owner thread uses the fake `opencode` ACP fixture.

### Run

```bash
# Builds, flips better-sqlite3 to the Electron ABI, runs all three, restores the
# Node ABI afterward (so `pnpm test` / vitest keep working).
pnpm run test:e2e:jobteam

# Already built + on the Electron ABI? Just run the three:
pnpm run test:e2e:jobteam:only
```

The `-g "Job Team"` grep also matches all three test titles if you prefer
`playwright test -g "Job Team"` (after a build + `pnpm run rebuild:electron`).

> **ABI note:** built-Electron Playwright needs `better-sqlite3` compiled for the
> Electron ABI (`pnpm run rebuild:electron`); vitest needs the Node ABI
> (`node scripts/ensure-better-sqlite3.mjs`, which `pnpm run rebuild` also does).
> `test:e2e:jobteam` handles both flips for you.

## Live coverage

These deterministic specs prove the full plumbing with no model spend. A real
OpenCode/Claude model actually reaching the tool is exercised separately, out of
this tree, by the owner of the integration (core stays unaware of it by design).
