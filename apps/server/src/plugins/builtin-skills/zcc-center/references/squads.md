# Squads

Squad (team) is named persona-slot bundle. Store in `~/.zcc/teams/` or `<project-root>/.zcc/teams/`; filename must equal `<id>.json`.

```json
{
  "id": "feature-squad",
  "name": "Feature Squad",
  "orchestratorPersonaId": "builtin:orchestrator",
  "slots": [
    { "personaId": "builtin:software-engineer", "quantity": 2, "label": "Engineer" },
    { "personaId": "builtin:reviewer", "quantity": 1, "label": "Reviewer" }
  ],
  "defaultProjectId": "real-project-id",
  "initialPrompt": "Break goal into tasks and integrate results.",
  "worktreeIsolation": true,
  "worktreeOnComplete": "leave",
  "routingEnforced": true,
  "retainOrchestrator": false,
  "defaultPlanning": "infer"
}
```

`id`, `name`, and non-empty `slots` required. Slot `personaId` required;
`quantity` clamps 1–16; maximum 64 slots. Persona existence is checked at
launch, not save. Orchestrator opens first and receives `initialPrompt`; it is
not implicitly added to slots. `defaultProjectId` is optional and checked at
launch. Invalid files are silently skipped; matching `builtin:*` shadows
built-in squad.

Optional launch fields: `worktreeIsolation`, `worktreeOnComplete` (`leave`,
`merge`, or `delete`), `routingEnforced`, `retainOrchestrator`, and
`defaultPlanning` (`infer` or `provided`). Launch-time settings and plan
`## Launch` declarations can override these values. Resolution is launch > plan
> Squad > default and is snapshotted at claim.

Squad JSON is not a command authority. Named deterministic checks are configured
by an owner in global or Project Settings; agent tools expose check names only.
