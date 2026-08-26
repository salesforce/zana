# Self-development: the workbench that builds itself

ZCC grows by plugins. Core is the runtime — threads, hosts, auth, path
confinement. A new user-facing capability is a plugin unless the broker cannot
grant it even scoped (Rule 7). This document is the product contract for that
loop. Implementation detail for slots and install lives in
[`plugin-system-plan.md`](./plugin-system-plan.md); this file is the closed-loop
invariant those plans must not regress.

## The loop

```
any thread  →  zcc-plugin-authoring skill  →  zcc plugin new / install / dev
            →  plugin (panel + zcc <verb> + skills/)
            →  generated plugin-commands skill + runtime skill roots
            →  later threads already know the verb
```

1. **Any thread can extend ZCC.** The Creator dialog is convenience UX, not the
   only authoring path. `zcc plugin new` plus path-install from an ordinary
   project thread is first-class.
2. **A plugin that adds a verb also teaches the next agent.** CLI contributions
   rewrite a generated skill. Manifest `zcc.skills` and
   `agents.contributeSkills` become runtime-injected roots for every provider,
   not only copies into `~/.claude/skills`.
3. **Catalog, not always-on body.** Every thread receives `{name, description}`
   for builtin, plugin, and generated skills. The agent loads the body when the
   description matches. `zcc-plugin-authoring` is always in that catalog.
4. **First-party features eat the same SDK.** Builtin plugins
   (`autoInstall: true`) reconcile on boot. Official plugins
   (`OFFICIAL_PLUGINS`, store-on-demand) skip reconcile until the user
   installs them. Concrete ids live only in
   [`builtin-registry.ts`](../../apps/server/src/plugins/builtin-registry.ts)
   and `APP_MODULES` until docs UI leaves the Vite graph (Rule 6).

## What stays core

Hosts/machines, keep-awake, OS secrets, and the scheduler are platform APIs.
Do not extract them as thin `navPanel` plugins. Tickets/GUS stay marketplace
disk extensions.

## Completion gate

From an ordinary Claude **and** Codex/Pi thread: “add a hello plugin with a
sidebar panel and `zcc hello`.” After install, a new thread’s catalog includes
`plugin-commands` listing `zcc hello`, and `zcc hello` runs.
