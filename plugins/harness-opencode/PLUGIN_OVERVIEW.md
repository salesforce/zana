Launch OpenCode as a CLI Agent in ZCC. The plugin owns the terminal session for the native `opencode` CLI.

## What you get

- A CLI Agent profile that opens OpenCode's own TUI inside ZCC.
- The same spawn, stop, and routing controls as other CLI Agents.

## How it works

ZCC starts `opencode` on an enrolled host through this plugin's PTY provider. Threads that pick this harness talk to that CLI, not to a separate ACP adapter.

## Requirements

- Install `opencode` on the host and keep it on `PATH`.
- Sign in with the CLI, for example `opencode auth login`.
