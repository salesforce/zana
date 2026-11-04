---
name: zcc-center
description: Author schedules, schedule templates, and personas for Zana by writing JSON files into .zcc. Use when the user asks to create, schedule, or automate a recurring agent/terminal task, to make a reusable schedule template, or to create/edit a persona (a reusable launch profile — role, model, system prompt, tools).
---

# zcc-center

## First Choose Surface

Inside Zana agent session, schedule work is MCP-first. Use `zcc-inbox` tools
`schedule_list`, `schedule_get`, `schedule_update`, `schedule_reload`,
`schedule_run_now`, and `schedule_set_enabled`. They manage Scheduler UI's
`.zcc/schedules` store. Do not use `zana_schedule_*` or `.zana/scheduler` YAML.

`zcc schedule update|reload|run-now|enable|disable` is refused to agents with
`FORBIDDEN_AGENT`. Use CLI only in human operator shell. Write disk JSON only
when user explicitly asks for file formats or direct repository artifacts.

When running inside scheduled session, call `schedule_report` before final
response. Report concise outcome, status, and user action needed. Use
`inbox_push` only when proactive attention is warranted.

## Read Detail On Demand

All format details live in references. Read exact reference before writing JSON.

- Scope, project ID lookup, schedule schema, cadence, profiles, and editing:
  [`references/schedules.md`](references/schedules.md)
- Reusable schedule templates: [`references/templates.md`](references/templates.md)
- Persona launch profiles: [`references/personas.md`](references/personas.md)
- Squad/team files and slot constraints: [`references/squads.md`](references/squads.md)
- Scheduled-run report and inbox behavior:
  [`references/run-reporting.md`](references/run-reporting.md)

## Durable Rules

Schedule requires real `projectId`; resolve it through registered projects and
never invent one. New schedule starts `status: { "runCount": 0, "runs": [] }`;
never fabricate history. Schedule filename must match `id`. Use one cadence only:
`every` or `cron`. Invalid JSON and invalid enum/cadence fields can be silently
skipped by loader, so validate before write.

Prefer per-project `.zcc/` files for repository automation, global `~/.zcc/`
for user-level automation. Keep profile permissions conservative. Suggest
`claude-yolo` only for unattended work proven safe.

## Finish

For direct-file edits, report path, project, profile, cadence, and enabled state.
For MCP edits, read live definition back with `schedule_get`. Run reports are
records, not logs; scheduler runs need report even when no inbox message.
