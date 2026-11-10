# skills-hooks-mcp fixture

Two Claude Code plugins for the squad skill-allowlist E2E specs.

- `skills-only/` contributes one skill (`only-skill`) and nothing else. Zana may disable it with `enabledPlugins: false`.
- `mixed/` contributes one skill (`mixed-skill`) plus a hook and an MCP server (`fixture-mcp`). It must stay enabled.

Specs copy these into the isolated HOME's `.claude/plugins/cache/test/<name>/1.0.0` and register them as `skills-only@test` and `mixed@test`.
