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
still run alongside ZCC's. To make its own session-injected hooks run, ZCC passes
`--dangerously-bypass-hook-trust`; at the pinned Codex version this flag is global, so it also
skips the trust prompt for enabled user/project hooks during a ZCC-launched session. Scoped
trust (trusting only ZCC's hooks and dropping the bypass flag) is a planned follow-up.

Use the core CLI skill for command syntax and official Codex guidance for
upstream product behavior.
