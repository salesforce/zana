# API surfaces to audit

New plugin SDK surfaces ship as `experimental_*` until they have a second
in-tree consumer and a documented contract.

| Surface | Status | Notes |
|---|---|---|
| `agents.experimental_registerProvider` | experimental | Thread provider catalog. May change without a major bump. |
| `agents.experimental_registerPtyHarness` | experimental | CLI Agent PTY family declaration. May change without a major bump. |
| Typed RPC (`rpc.method` + Standard Schema) | not yet | Untyped handlers are the day-one contract. |
| `zcc.host` workers | deferred | Manifest field exists; no authoring loop yet. |
| Product SDK (`zcc.sdk` spawn/HTTP) | deferred | Use the CLI / public HTTP instead. |
| Plugin-to-plugin `zcc.services` | experimental | `provide`/`use` live proxy. May change without a major bump until a second in-tree consumer exists. |
| `planStepsPresentation` | stable | Provider contract: emit `item/completed` `{ type: "planSteps", steps: [{ step, status }] }` (`pending` / `active` / `completed`). Core persists to `thread_plan_tasks` and the live todo banner. `experimental_planStepsPresentation` remains an alias. |
| `zcc.plans` | deferred | Durable thread plans stay in core (composer mode, SQLite, `.zcc/plans`, PlanExecutionCard). Plugins that need read/subscribe should use HTTP `POST/PATCH /api/v1/threads/:id/plan/tasks` until a second in-tree plugin needs a typed SDK. Do not extract plan chrome into a plugin. |

Do not promote an experimental surface to stable from a single plugin.
