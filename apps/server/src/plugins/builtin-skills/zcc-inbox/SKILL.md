---
name: zcc-inbox
description: Route Zana inbox, scheduler, remote-project, library, and Squad work to the correct MCP tools and snapshot-local references.
---

# zcc-inbox

`zcc-inbox` is automatically wired into in-app sessions. Project and session
identity comes from its MCP route; never invent ids, paths, hosts, or credentials.

## Route Requests

| Request | Use | Read only when needed |
| --- | --- | --- |
| Report, user update, or question | `inbox_push` | `references/inbox.md` |
| Search earlier agent reports | `inbox_search` | `references/inbox.md` |
| Scheduler UI schedules | `schedule_*` | `references/schedules.md` |
| Remote registered project | `remote_*` | `references/remote.md` |
| Project library or goals | `library_*`, `goal_*` | `references/library.md` |
| Durable Squad or execution | `squad_*`, `execution_*` | `references/squads.md` |

For broad local discovery use native `Glob` or `Grep`. Read identified files
with native `Read`; request only supported ranges. Do not substitute shell reads.

## Safety

- `inbox_push` only when user needs durable visibility. Avoid progress noise.
- Remote tools accept registered project ids only. Never supply raw SSH host or credentials.
- `squad_launch` uses `mode: 'review'` unless user explicitly says start now.
- Execution route/session identity and remote project confinement are host-owned.
- Tool schemas are authoritative. Do not infer undocumented fields.

## References

References are inside this immutable skill snapshot. Load only reference matching
current work; do not preload detailed schemas or examples.

- `references/inbox.md` — reports, questions, and inbox search.
- `references/schedules.md` — Scheduler UI operations.
- `references/remote.md` — remote project work.
- `references/library.md` — library and goal tools.
- `references/squads.md` — Squad and durable execution workflow.

### Hand a design to a Squad

| Operation | CLI Agent MCP tool | Modern/OpenCode tool |
|---|---|---|
| Answer a question it reported | `mcp__zcc-inbox__execution.respond` | `zcc_execution_respond` |

`mcp__zcc-inbox__squad_plan_check` / `mcp__zcc-inbox__squad_propose` and
`zcc_squad_plan_check` / `zcc_squad_propose` prepare a review launch.
`mcp__zcc-inbox__squad_launch` / `zcc_squad_launch` start it only when the user
explicitly asks now. `execution.start` is for agent-owned orchestration. It is the
low-level path (explicit slots, work units, policy) and is deprecated for agent
use. Add `notify: true` so the run reports back to you.

| User says (examples) | Path | Tools |
|---|---|---|
| "build it with X" | Review first | `squad_plan_check` → `list_teams` → `squad_launch` with `mode: 'review'` |
| "run this with X now" | Start now | `squad_launch` with `mode: 'now'` |
| Anything else, or unclear | Review first | `squad_launch` with `mode: 'review'` |

Start now only when the user's message explicitly asks to start immediately. Do not
infer it from urgency or from "go ahead". Say which path you took, in one line.
After Start you will receive a
`[Squad report]` when the run finishes or needs a human answer. Don't poll in
a loop. Answer with `execution.respond { executionId, expectedStateVersion, blockerId, message }`.
For review-first, pass sources by their exact paths (do not copy them), then call
`squad_launch` with `mode: 'review'`; do not call `execution.start`. Use `mode: 'now'` to build a design only
when the user explicitly asks to start now.
