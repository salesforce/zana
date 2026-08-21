# First-party plugins (`plugins/`)

This directory holds first-party plugins. They are distinct from the plugin
host (`apps/server/src/plugins/`, `apps/app/src/plugins/`), which discovers
and loads any installed plugin.

## Current

| Package | Role |
| --- | --- |
| `docs/` | Builtin (`autoInstall: true`) — Docs rail, per-project Library, and the library-curator skill. The panel UI is compiled into the renderer (`apps/app/src/views/library`); this package ships the skill + server. Packaged builds copy `plugins/` via electron-builder extraResources. |

Do not add a runtime plugin to `MAIN_MODULES`. Author it with a `package.json`
`zcc` block under `plugins/<id>` and install it through the plugin workflow.
