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

Required fields: `id`, `name`. `baseProfile`: `claude`, `claude-resume`, `claude-yolo`, or `shell`. `model`: `opus`, `sonnet`, `haiku`, or `default`. `permissionMode`: `default`, `acceptEdits`, `plan`, or `bypassPermissions`; ignored for `claude-yolo`. `reasoningLevel` (optional): `low`, `medium`, `high`, `xhigh`, or `max`. Each harness maps it: Claude `--effort`, Codex `model_reasoning_effort`, PI `--thinking`, Grok `--reasoning-effort` (xhigh/max become high); OpenCode and Cursor use it only in Modern Squads; any other value skips the persona. `skills` (optional string array): omit for unrestricted; a list restricts the persona to those skills plus `zcc-inbox` (always allowed), and `[]` means only `zcc-inbox`. Entries are bare names or `plugin:name`. It is a context filter, not a security boundary; on Claude CLI sessions a plugin none of whose skills are listed is switched off whole (including any hooks, tool servers, or agents it ships); a plugin with only some of its skills listed stays on. An explicit list wins over a Team's lean workers option. `initialPrompt` is Claude-only. Invalid JSON or invalid enum is silently skipped. Matching `builtin:*` ID shadows built-in persona.
