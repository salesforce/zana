Launch Pi as a CLI Agent in ZCC. The plugin owns the terminal session for the native `pi` CLI.

## What you get

- A CLI Agent profile that opens Pi's own TUI inside ZCC.
- The same spawn, stop, and routing controls as other CLI Agents.

## How it works

ZCC starts `pi` on an enrolled host through this plugin's PTY provider. Threads that pick this harness talk to that CLI, not to a separate ACP adapter.

## Requirements

- Install `pi` on the host and keep it on `PATH`.
