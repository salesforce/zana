# Squad and Execution Reference

Default flow: validate supplied portable plan with `squad_plan_check`, inspect
teams with `list_teams`, then call `squad_launch` with `mode: 'review'`. User
launches review card. Use `mode: 'now'` only after explicit immediate-start
instruction. Do not simulate durable work with ad-hoc messages.

Execution controls are route-bound. Use `execution.snapshot` after user asks for
detail or report arrives. Answer a blocker only when user-provided context decides
it; otherwise ask user.

```ts
squad_plan_check({ path })
list_teams()
squad_launch({ teamId, goal, planning, sources, mode: 'review' })
execution_snapshot({ executionId, after })
execution_respond({ executionId, expectedStateVersion, blockerId, message })
```
