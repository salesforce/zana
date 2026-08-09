# __EXT_TITLE__

A **local** Zana extension (id `__EXT_ID__`), authored in-app. Not published.

## Layout

- `extension.json` — the manifest (id, title, icon, permissions, `projectTab`).
- `dist/renderer.js` — the panel, plain ESM. The host injects React + a
  capability bridge (`host`) into `activate({ React, host })`.

## Surfaces

This starter contributes **two** views from the same component:

- A **global** sidebar entry.
- A **per-project tab** (declared by `"projectTab"` in `extension.json`).

The panel branches on `host.getScopedProjectId()` — `null` in the global view,
the project id when mounted as a project tab — so it can scope its data.

## Build / reload loop

This starter is renderer-only and needs no build step — edit
`dist/renderer.js` directly. When you're happy, open the Extensions hub and
click **Reload from source** to reinstall your changes. Adding a permission to
`extension.json` re-triggers the consent prompt before it takes effect.

## Publishing later

When ready, package this dir and share it — it installs like any other disk
extension. Nothing here is tied to your machine.
