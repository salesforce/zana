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
squad_plan_check({ path, teamId }) // advisory tierFit for the chosen Squad; never blocks
squad_launch({ teamId, goal, planning, sources, attachments, mode: 'review' })
execution_snapshot({ executionId, after })
execution_respond({ executionId, expectedStateVersion, blockerId, message })
```

`squad_launch` and `squad_propose` accept flat optional launch fields, including
`worktree`, `onComplete`, `push`, `checks`, `failurePolicyDefault`, and `target`.
`target` is `{ kind: 'project-root' }` or `{ kind: 'worktree', branch }`; never
send a raw path. An existing-worktree target is resolved and revalidated by host
code against the Project's Git worktrees. It is user-owned, so it can only
`leave`; merge and delete are rejected. `target` with `worktree: true` is also
rejected. Do not describe a local target as a remote default.

Review cards show resolved settings and location. With `mode: 'now'`, receipt
shows actual location after launch; no review card is added, but existing
`launchApproval` can still reject `now` with `LAUNCH_REVIEW_REQUIRED`.

Tool exposure is an operational prerequisite. Do not treat loopback access as
caller authentication or claim these controls are agent-proof. Main-process path
confinement and route-bound authorization remain required.

A registered SSH remote Project uses its configured remote default path. Infer
and provided plans, including inline provided plans and locally attached source
capabilities, can preview without local remote-checkout I/O. Do not request an
explicit `target`, worktree isolation, named checks, or push for a remote Project:
host preview rejects them with no local fallback. Relative local sources are not
available for a remote Project; use an approved absolute local attachment.

Named checks are unsupported on Windows. Any launch referencing `check:<name>`
is rejected during preview/admission before workers spawn, rather than failing
later at completion. Do not claim named checks work on every platform.

Attachments (`attachments: [{ name, text }]`, also on `squad_propose`) carry text
that is not on disk. Files and attachments share one budget: 16 items, 4 MiB each,
16 MiB total; names are plain file names of at most 128 UTF-8 bytes. Names are
NFC-normalised and clash case-insensitively: identical name and content fold into
one (`deduplicated`); different content gets a ` (n)` suffix; a numbered name over
128 bytes is refused `NAME_TOO_LONG`. The result's `attachments` maps
`{ given, used, deduplicated? }`. A plan is limited to 1 MiB. On remote/SSH Projects
attachments work, but relative path sources are not readable; use absolute paths
under allowed locations. The coordinator reads attachments through the
`execution.source` tools.
