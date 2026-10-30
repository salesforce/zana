# Personas

Personas are reusable launch flag bundles, not runtimes. Store in `~/.zcc/personas/` or `<project-root>/.zcc/personas/`; filename must equal `<id>.json`.

```json
{
  "id": "backend-engineer",
  "name": "Backend Engineer",
  "baseProfile": "claude",
  "model": "sonnet",
  "permissionMode": "acceptEdits",
  "appendSystemPrompt": "Favor small slices and tests.",
  "allowedTools": ["Read", "Grep", "Glob", "Edit", "Bash"],
  "deniedTools": [],
  "addDirs": [],
  "mcpServers": [],
  "initialPrompt": "What backend change?"
}
```

Required fields: `id`, `name`. `baseProfile`: `claude`, `claude-resume`, `claude-yolo`, or `shell`. `model`: `opus`, `sonnet`, `haiku`, or `default`. `permissionMode`: `default`, `acceptEdits`, `plan`, or `bypassPermissions`; ignored for `claude-yolo`. `initialPrompt` is Claude-only. Invalid JSON or invalid enum is silently skipped. Matching `builtin:*` ID shadows built-in persona.
