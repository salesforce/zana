# @zcc/cli

Thin, no-daemon CLI for reading Zana Command Center stores.

## Scope

**READ/AUTHOR TIER ONLY** (v1). This CLI reads the same `~/.zcc/*.json` files the Electron app uses. Live actions (launching sessions, IPC control) are deferred for future versions.

## Installation

```bash
# From the monorepo root
npm install

# Build the CLI
cd packages/cli
npm run build
```

## Usage

```bash
# Via node (from repo root)
node packages/cli/dist/bin/zcc.js projects ls

# Or add to PATH
export PATH="$PWD/packages/cli/dist/bin:$PATH"
zcc projects ls
```

## Commands

```bash
# Projects
zcc projects ls              # List all projects
zcc projects ls --json       # JSON output

# Personas
zcc personas ls              # List personas (disk files only)
zcc personas ls --json

# Schedules
zcc schedule ls              # List scheduled tasks
zcc schedule ls --json

# Inbox
zcc inbox ls                 # List recent inbox entries
zcc inbox ls --project <id>  # Filter by project (accepts id or tag)
zcc inbox show <id>          # Show full entry
```

## Configuration

By default, reads from `~/.zcc/`. Override with:

```bash
ZCC_CENTER_DIR=/custom/path zcc projects ls
```

## Output Modes

- **Human table** (default): Clean tables for terminal reading
- **JSON** (`--json` flag): Machine-readable output for scripts/agents

## Testing

```bash
npm test              # Run vitest tests
npm run test:watch    # Watch mode
```

## Architecture

Follows CU's `runCli()` discipline:
- Pure function returns `{ exitCode, stdout, stderr }` — never calls `process.exit` mid-logic
- Never writes to console directly — returns strings
- Testable with golden files (see `src/__tests__/run-cli.test.ts`)

Store readers are defensive: missing files or malformed JSON return empty lists + warnings on stderr, never throw.

## Store Format

Reads the same stores as the Electron app:
- `~/.zcc/projects.json` — project list (v0 array or v1 `{version, projects}`)
- `~/.zcc/personas/<id>.json` — global personas
- `<project>/.zcc/personas/<id>.json` — per-project personas
- `~/.zcc/schedules/<id>.json` — global schedules
- `<project>/.zcc/schedules/<id>.json` — per-project schedules
- `~/.zcc/inbox/entries.jsonl` — inbox entries (JSONL: one JSON per line)

Note: builtin personas (`builtin:reviewer`, `builtin:architect`) exist in code only and are not listed by the CLI.

## Future (deferred)

Live actions (launching sessions, run-now, IPC control) require the Electron app to be running and will use a localhost control socket. Scope guard: v1 is READ/AUTHOR only.
