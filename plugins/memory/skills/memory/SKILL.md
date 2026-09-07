---
name: memory
description: Retrieve relevant durable ZCC memories or save verified knowledge useful to future threads.
---

# ZCC memory

This plugin is provider-independent. When diagnosing duplicate memories, check
whether provider-native memory is also enabled.

The plugin injects a compact index of global memories and memories for the
current project. The index contains summaries only.

## Retrieve progressively

1. Search with `zcc memory search "<query>" --json`.
2. Read the selected record with `zcc memory get <id> --json`.
3. Treat remembered facts as potentially stale.

Do not load every memory. Stop after the relevant records are clear.

## Save durable learning

Use project scope for repository-specific information (commands, conventions,
decisions). Use global scope only for user preferences that apply across
repositories. When scope is ambiguous, use project scope and pass
`--project <id>` (or rely on `ZCC_PROJECT_ID`).

```bash
zcc memory add --scope project --project <id> \
  --name <stable-kebab-name> \
  --summary "<one-line routing summary>" \
  --details "<complete durable detail>" \
  --kind fact \
  --reason "<why this will help a future thread>" \
  --json
```

Update with version checks:

```bash
zcc memory update <id> --expected-version <version> \
  --summary "<new summary>" --details "<new details>" \
  --reason "<why the memory changed>" --json
```

Forget a revoked memory with:

```bash
zcc memory forget <id> --expected-version <version> \
  --reason "<why it no longer applies>" --json
```

Inspect past versions with `zcc memory history <id> --json`.

## Quality and safety

Do not store secrets, credentials, guesses, transient task status, or policy
already expressed in `AGENTS.md`. Keep summaries short. Explicit user requests
and repository guidance win over memory.
