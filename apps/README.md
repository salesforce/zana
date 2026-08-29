# ZCC Runtime Applications

The runtime follows a server-host split while preserving ZCC's authorization
boundary: renderer and host daemon submit intent; the server authorizes and
commits durable state.

No app may import another app's `src/`. Cross-app types go through workspace
packages.

| Application | Responsibility | Current migration status |
| --- | --- | --- |
| `app` | React product UI | Renderer lives at `apps/app/src` with navigable screens under `views/`. Widgets remain in `components/`; `use*` hooks in `hooks/`; remaining helpers in `lib/`. Electron-vite still owns the production bundle from the repo root. |
| `server` | Product policy, durable state, plugin host | Domain services live under `apps/server/src/services/<domain>/` and are imported via `@zana-ai/zcc-server`. Electron main remains the in-process host during extraction. |
| `host-daemon` | Server-authorized PTY / harness execution | PTY, harness providers, tmux, remote, and microVM live under `apps/host-daemon` and are imported via `@zana-ai/zcc-host-daemon`. Live spawn still runs in-process from the desktop host. |
| `desktop` | Electron window, preload, updater, menus, runtime supervision | Shell sources live under `apps/desktop/src` (preload, bootstrap, tray/menu/updater, `window/`, `runtime/`, `native/`, `extensions/`, `host.ts`). electron-builder config is `apps/desktop/electron-builder.yml`. |
| `web` | Marketing / docs / marketplace site | Pending physical relocation from `website/`. |

## `apps/app` target tree

Every user-navigable screen lives under `views/<destination>/`. Widgets used *by*
views stay in `components/<domain>/`. Do not add a `features/` directory.

```
apps/app/src/
  views/           # home, inbox, agents, follow-ups, suggestions,
                   # scheduler, extensions, settings, project, library
  components/      # layout, agents, inbox, settings, scheduler, explorer,
                   # palette, dialogs, terminal, ui (primitives graduate to packages/ui)
  hooks/
  lib/             # feedCategories, fuzzy, markdown, …
  stores/          # split of today's zustand store.ts
  plugins/         # PluginSlotBoundary / definePluginApp host
  modules/         # ModulePanelHost (legacy extension panels)
```

`App.tsx` switches on `nav` and renders a view. `WorkspaceView` switches on
`workspaceMode`. Plugin/extension panels mount through `modules/` / `plugins/`
(Rule 6 — core must not name a concrete extension).

## `apps/desktop` target tree

```
apps/desktop/src/
  bootstrap.ts, main.ts, preload.ts, menu.ts, tray.ts, updater.ts
  window/          # bounds, zoom, renderer URL, content-screen
  runtime/         # runtime-supervisor
  native/          # keep-awake, openers, dock/tray, voice OS permission
  ipc/             # compatibility adapters — one file per remaining IPC family
```

Desktop may import `@zana-ai/zcc-contracts`, `@zana-ai/zcc-desktop-contract`,
and server/host package entrypoints. It must not import `apps/app/src` and must
contain no React. Preload stays CJS (Electron sandbox cannot load ESM preload).
