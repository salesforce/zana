# Inbox Reference

Use `inbox_push` for completed reports, a decision, a blocker, or an update the
user must see after this session. Supply `docs` as project-relative live paths.
Use `report: true` only for finished deliverables. Structured options fit discrete
choices; set `blocking: true` only when work cannot proceed without an answer.

Use `inbox_search` for prior reports. Default scope is current project. Set
`allProjects: true` only when user explicitly asks to search every project.

```ts
inbox_push({ subject, intent, comments, docs, report, options, blocking })
inbox_search({ query, limit, before, allProjects })
```
