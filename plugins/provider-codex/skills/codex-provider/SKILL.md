---
name: codex-provider
description: "Diagnose ZCC-specific Codex session controls, model acceptance, and durable goals."
---

# Codex provider

Codex supports structured plan requests, editing and rerunning eligible messages,
and compaction through the thread’s supported controls. Inspect the thread with
`zcc thread show <id> --json` before recovery actions, and use `zcc guide threads`
for the commands available in this build. Clearing a durable active Goal requires
provider confirmation.

Unlisted model IDs are accepted by this provider; acceptance does not establish
account access. Select the actual execution machine in the thread composer when
inspecting its model catalog. `zcc machine provider-cli status <host-id> --json`
checks the host’s installed provider CLIs.

ZCC injects its lifecycle hooks into Codex's session-flags config layer (no file is written
to `~/.codex/config.toml`). Codex appends hooks per config layer, so user and project hooks
still run alongside ZCC's. For a local Codex binary ZCC has verified (a one-time probe per
path and version confirms Codex computes the same hook hashes), ZCC passes a `hooks.state`
override trusting only its own hooks, so user/project hooks keep their normal trust state. If
the probe is pending, fails or mismatches, and for every remote (SSH) launch, ZCC falls back to
the global `--dangerously-bypass-hook-trust`, which also skips the trust prompt for enabled
user/project hooks in that session.

Use the core CLI skill for command syntax and official Codex guidance for
upstream product behavior.
