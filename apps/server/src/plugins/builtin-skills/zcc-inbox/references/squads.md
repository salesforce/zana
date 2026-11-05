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
squad_launch({ teamId, goal, planning, sources, attachments, mode: 'review' })
execution_snapshot({ executionId, after })
execution_respond({ executionId, expectedStateVersion, blockerId, message })
```

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
