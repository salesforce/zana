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
  "initialPrompt": "Break goal into tasks and integrate results."
}
```

`id`, `name`, and non-empty `slots` required. Slot `personaId` required; `quantity` clamps 1–16; maximum 64 slots. Persona existence is checked at launch, not save. Orchestrator opens first and receives `initialPrompt`; it is not implicitly added to slots. `defaultProjectId` is optional and checked at launch. Invalid files are silently skipped; matching `builtin:*` shadows built-in squad.
