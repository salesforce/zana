# Live Test: Cross-Project Orchestration + Zana Goal Feature (2026-06-23)

Two live tests run from this command-center session (I acted as the top-level
orchestrator). Every claim below is backed by real spawned agents and real
files on disk — nothing simulated.

## TL;DR

| Capability | Verdict |
|---|---|
| Top-level agent spawning (me → worker) | ✅ Works |
| Agent works on Project X via absolute path | ✅ Works |
| Agent creates Project Y (`mkdir` + `git init` + file) | ✅ Works |
| Agent works on Project Y | ✅ Works |
| **Zana Goal feature** (autopilot_goal_driven, define → achieve → evaluate) | ✅ **Works** |
| **One agent autonomously spawning + coordinating sub-workers** | ❌ **Broken** |

The horizontal multi-project *file work* is possible. The **autonomous
self-coordination** the test was really probing is **blocked by a real bug**:
a spawned (headless) agent cannot itself spawn another agent.

## The bug (reproduced twice, independently)

When an agent that was itself spawned by Zana calls `zana_spawn_agent` (or
`zana_oneshot_query`, `zana_list_agents`, `zana_list_profiles`,
`zana_discover_agents`, ticket/team/skill list tools…), the call returns:

```json
{ "error": "unknown action: undefined" }
```

- It is **nesting-specific**. My *top-level* calls to `zana_spawn_agent` worked
  fine — I spawned 4 agents this session (orchestrator `c2841f2d`, goal worker
  `68c64411`, goal evaluator `6c16e1f8`, verifier `e9d10d19`).
- The orchestrator (`c2841f2d`) hit it on every daemon-dispatched tool and could
  not spawn a single worker.
- A second independent worker (`e9d10d19`), spawned by me directly, reproduced
  the exact error on its nested `zana_spawn_agent` call — while its filesystem
  steps (1–3 below) all succeeded.

Only `zana_workers_list` and `zana_team_status` (handlers that don't go through
the action dispatcher) returned data; everything routed through the dispatcher
failed with the `undefined` action.

### Likely cause (code-level, for follow-up)

`packages/mcp/src/registrations/agents.ts` maps `zana_spawn_agent` →
`callCore("spawn_agent", …)`. From a *nested* (sub-agent) context the action
name is arriving as `undefined` at the dispatcher — the wrapper that injects the
action/`callerAgentId` for an agent-initiated call isn't populating it. Worth
tracing how `callCore` resolves the action string when the caller is a headless
agent vs. the top-level MCP client.

## Two design gaps (separate from the bug)

1. **No project targeting on spawn.** `zana_spawn_agent` exposes only
   `profileId` + `prompt` — no `projectId`/`cwd`. Spawned agents inherit the
   daemon's workspace (here `zana-command-center`); both verified workers
   reported `pwd` = `/Users/grebmann/Documents/claude-workspace/zana-command-center`,
   **not** project-x/project-y. Cross-project work only happened because the
   agents used **absolute paths** in their prompts.
2. **Absolute-path writes were NOT confined.** Both workers wrote to
   `~/zcc-workspace/zana-live-test/...` (outside their cwd and, for project-y,
   to a path that was not a registered project) with no block. This contradicts
   the spirit of CLAUDE.md Rule 2 (confine paths before trusting them) — worth
   confirming whether headless-agent Bash should be sandboxed to the project.

## Evidence — files on disk

```
~/zcc-workspace/zana-live-test/
├── goal-result.md          ← Zana Goal feature output
├── project-x/
│   ├── README.md
│   └── STEP1.md            ← "Project X touched" / "worker-x was here"
└── project-y/              ← created live by a worker (git init'd)
    └── STEP2.md            ← "Project Y created"
```

## Test 2 detail — Zana Goal feature ✅

`zana_autopilot_goal_driven` with a verifiable criteria
(file exists + contains "GOAL ACHIEVED" + correct sum 17+25=42):

- Goal `de34a67b` → status **completed** in **iteration 1**.
- Step worker (`68c64411`) wrote the file; a separate evaluator agent judged the
  criteria and returned `VERDICT: PASS`.
- `goal-result.md` on disk:
  ```
  GOAL ACHIEVED
  computed: 42
  ```

The define → execute → evaluate → verdict loop works end-to-end. (Note: each
goal *step* is a single top-level spawn by the autopilot engine, so it doesn't
hit the nested-spawn bug — that's why this passed while the orchestrator failed.)

## Bottom line

- **Zana Goal feature: working.** Confident, verified live.
- **Autonomous cross-project orchestration: not yet.** An agent can touch
  multiple projects' files via absolute paths, but it **cannot spawn or
  coordinate its own sub-workers** — the recursive-spawn dispatch is broken.
  Fix that one bug and the orchestrator scenario should become testable; the
  project-targeting + path-confinement gaps are the next things to close.
