Keep pull requests you authored visible in ZCC. The plugin watches CI, review, and merge-readiness through the local GitHub CLI.

## What you get

- A list of your open pull requests with CI and review status.
- Inbox alerts when a PR needs attention.
- The same `gh` session you already use in the terminal.

## How it works

PR Monitor calls `gh` on this host. It does not store GitHub tokens in ZCC. Status refreshes in the background while the plugin is enabled.

## Requirements

- Install the GitHub CLI (`gh`) and run `gh auth login`.
- The host must be able to reach GitHub.
