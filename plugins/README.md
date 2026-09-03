# First-party plugins (`plugins/`)

This directory holds first-party plugins. They are distinct from the plugin
host (`apps/server/src/plugins/`, `apps/app/src/plugins/`), which discovers
and loads any installed plugin.

## Current

| Package | Role |
| --- | --- |
| `docs/` | Builtin (`autoInstall: true`) — Docs rail, per-project Library, and the library-curator skill. The panel UI is compiled into the renderer (`apps/app/src/views/library`); this package ships the skill + server. Packaged builds copy `plugins/` via electron-builder extraResources. |
| `plugin-guide/` | Builtin (`autoInstall: true`) — Plugin Guide under Plugins: annotated wireframe map of every SDK surface, Copy for agent, and links into installed plugin hub pages. |
| `salesforce/` | Official (`autoInstall: false`) — Salesforce DX inner loop. Install with `zcc plugin install salesforce`. Org doctor, SOQL/Apex/LWC/Agent Script family tools, and fail-closed mutation confirms. |
| `posthog-analytics/` | Official (`autoInstall: false`) — opt-in usage analytics sent to a user-configured PostHog project: agent lifecycle events plus optional content-free UI-click ids. Off by default; never sends prompt/response content, labels, or input values. |

Do not add a runtime plugin to `MAIN_MODULES`. Author it with a `package.json`
`zcc` block under `plugins/<id>` and install it through the plugin workflow.
