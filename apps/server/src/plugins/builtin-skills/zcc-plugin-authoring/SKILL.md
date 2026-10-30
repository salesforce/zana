---
name: zcc-plugin-authoring
description: Extend Zana itself by writing a plugin — panel, CLI command, skills, settings, storage, HTTP, and SDK surfaces. Use when the user asks to add a capability ZCC does not have yet, or to create/install/reload a plugin with `zcc plugin new`, `install`, `dev`, and `types`.
---

# zcc-plugin-authoring

ZCC grows through plugins. Keep core limited to runtime, authentication, and confinement. Build a plugin for every new user-facing capability unless scoped permission cannot grant its needed capability.

For meaningful UI work, use `zana-ui-proposals` early. Show working alternatives or Current / Proposed. Trivial fixes stay lightweight; direct implementation requests need no extra approval.

Start from **Plugins → New plugin**, Browse **Create a plugin**, or composer **Plugin**. Use ordinary project thread, not dedicated Extensions project.

```bash
zcc plugin new hello --app
cd zcc-plugin-hello
zcc plugin install .
```

Install makes path plugin live. Use smallest next loop:

- Unit-test logic: Vitest plus `@zana-ai/zcc-plugin-sdk/testing`; no app or `dev`.
- Compile: `zcc plugin build`; no app or `dev`.
- Backend edit: `zcc plugin reload <id>`; `dev` optional.
- `zcc.app` edit: `zcc plugin dev`, or build then reload.

`zcc plugin dev --once` is preferred agent iteration: one build/reload/health cycle and nonzero failure. Do not start watch loop unless UI iteration needs it. Path installs load `server.ts`; git/npm/builtin packages declare JS entry.

## Read Detail On Demand

Read one reference before work in its area. References are part of this skill tree and are snapshot-owned, so use only relative paths below.

- Commands, scaffold, build toolchain, and reload: [`references/workflow.md`](references/workflow.md)
- `ZccPluginApi`, thread APIs, storage, HTTP/RPC, agent tools, host bridge, and services: [`references/server-sdk.md`](references/server-sdk.md)
- `definePluginApp`, slots, React helpers, composer integration, panels, and Plugin Guide: [`references/app-slots.md`](references/app-slots.md)
- Skill contributions, generated commands, and approvals: [`references/skills-and-approvals.md`](references/skills-and-approvals.md)
- Unit, app-slot, and live-ZCC verification: [`references/testing.md`](references/testing.md)

## Durable Boundaries

Plugins run in-process after install. Renderer input remains untrusted: host/main must authorize paths, project IDs, and destructive actions. Do not recreate a product API in a plugin; use declared SDK or plugin service contracts. Never expose host-daemon tokens or Salesforce credentials to plugin code.

For user-confirmed plugin UI actions, use host-signed approval. Rebuild binding from trusted server state before consuming token. Headless or unavailable approval fails closed. Agent-initiated actions keep thread guardrails.

New threads receive generated `plugin-commands` and contributed skills for every supported provider. Do not assume copying into `~/.claude/skills` is enough.

## Finish

Use tests matching changed surface. For UI work, run real slot in running ZCC; build alone proves neither mount nor action. Report commands and observed behavior. If computer-use unavailable, name unverified live check.
