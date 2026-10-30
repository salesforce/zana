# Templates

Templates prefill Scheduler's new schedule form and never run. Store globally in `~/.zcc/templates/` or per-project in `<project-root>/.zcc/templates/`; filename is free-form.

```json
{
  "id": "dependency-audit",
  "name": "Dependency audit",
  "description": "Weekly dependency check.",
  "category": "Maintenance",
  "icon": "Package",
  "defaults": {
    "profile": "claude-yolo",
    "every": "24h",
    "name": "Dependency audit",
    "prompt": "Audit dependencies.",
    "extraArgs": []
  }
}
```

`id`, `name`, and `defaults` are required. `defaults.profile` and `defaults.every` follow schedule validation. Templates have no `projectId`; user chooses project at instantiation. Matching built-in ID shadows built-in template.
