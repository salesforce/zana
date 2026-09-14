Launch Codex as a CLI Agent in ZCC. The plugin owns the terminal session for the native `codex` CLI.

## What you get

- A CLI Agent profile that opens Codex's own TUI inside ZCC.
- The same spawn, stop, and routing controls as other CLI Agents.

## How it works

ZCC starts `codex` on an enrolled host through this plugin's PTY provider. Threads that pick this harness talk to that CLI, not to a separate ACP adapter.

## Requirements

- Install `codex` on the host and keep it on `PATH`.
- Sign in with the CLI, for example `codex login`.
