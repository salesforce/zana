# Build your first extension (5 minutes)

This is the shortest path from nothing to a working panel inside Zana Command
Center. It uses only the renderer side — a React panel with **no permissions**,
so it installs without a consent prompt. When you're ready for main-process
capabilities (`exec` / `fs` / `fetch`), personas, per-project tabs, and
publishing, continue to the full [Authoring guide](extensions-authoring.md).

An extension is plain TypeScript built against the stable `@zana-ai/zcc-extension-sdk`
contract, loaded at runtime from disk — you never rebuild the app.

## What you'll build

A sidebar panel with a button that shows a host toast. Three files:

```
~/.zcc/extensions/hello/
  extension.json     manifest (id, title, entry, api range)
  renderer.js        the panel bundle (built from renderer.ts)
```

## 1. Scaffold

The fastest start is the scaffolder, which sets up the manifest, a renderer
entry, and a Vite build already configured with the right externals:

```sh
npx create-zcc-extension hello
cd hello
npm install
```

Prefer to see the moving parts? The next two steps show the whole extension by
hand — the scaffold just writes these for you.

## 2. The manifest — `extension.json`

```json
{
  "id": "hello",
  "title": "Hello",
  "icon": "Sparkles",
  "entry": { "renderer": "renderer.js" },
  "engines": { "zccApi": "^1.0.0" },
  "permissions": []
}
```

- `id` is stable and URL-safe; it doubles as the nav id and the storage
  namespace.
- `icon` is a [lucide-react](https://lucide.dev/icons/) icon name, resolved
  host-side (unknown names fall back to `HelpCircle`).
- `engines.zccApi` is the contract range the host gates against at load.
- `permissions: []` means no consent prompt — a bare panel installs silently.

## 3. The panel — `renderer.ts`

The renderer bundle default-exports a `RendererEntry`: an
`activate({ React, host })` factory that returns your panel component. The host
passes in **its own React instance** — never `import 'react'` yourself, or a
second copy breaks hooks.

```ts
import type { RendererEntry } from '@zana-ai/zcc-extension-sdk/renderer';

const entry: RendererEntry = {
  activate({ React, host }) {
    return function Panel() {
      return React.createElement(
        'button',
        {
          onClick: () => host.toast(`Hello from ${host.moduleId}!`)
        },
        'Say hello'
      );
    };
  }
};

export default entry;
```

`host` (a `ModuleHost`) is the **only** surface your panel touches — there's no
`window.cc` escape hatch. It exposes `moduleId`, `call`, `storage`,
`pushInbox`, `toast`, `openExternal`, `getActiveProject`, `listProjects`,
`selectProject`, `launchSession`, plus `on` (events) and `cache`. Want JSX and
an icon library instead of `React.createElement`? See
[Using JSX, hooks, or a UI library](extensions-authoring.md#using-jsx-hooks-or-a-ui-library-eg-lucide-react).

## 4. Build

```sh
npm run build
```

The scaffold's Vite config builds in **library mode** and externalizes what the
host owns (`react`, `react-dom`, `react/jsx-runtime`, `lucide-react`). The
output filename must match the manifest's `entry.renderer` (`renderer.js`).

## 5. Install and see it live

The lowest-level dev loop is a copy into the extensions dir:

```sh
ID=hello
mkdir -p ~/.zcc/extensions/$ID
cp extension.json dist/renderer.js ~/.zcc/extensions/$ID/
```

Open ZCC — **Hello** appears in the sidebar with your panel. A file-watcher on
`~/.zcc/extensions` reconciles changes live, so the dev loop is just:

> edit `src/` → `npm run build` → re-copy → the panel reloads.

You can also install without touching the filesystem: **Settings → Extensions →
Marketplace → Install from folder…** and pick your built dir. Same validation
the marketplace uses.

## Where to go next

- **Add capabilities** — run an allowlisted binary, read files, or fetch a URL
  from an optional main module (`ctx.exec` / `ctx.fs` / `ctx.fetch`),
  permission-gated by a broker:
  [The main module](extensions-authoring.md#the-main-module-optional) and
  [Permissions](extensions-authoring.md#permissions-are-enforced-for-disk-extensions-p3-b).
- **Surface it differently** — a
  [per-project tab](extensions-authoring.md#per-project-tabs-projecttab),
  [command-palette commands](extensions-authoring.md#contributions-commands-and-navbadge-panel-now-optional),
  or a [framework preset](extensions-authoring.md#framework-presets-agentpreset).
- **Contribute personas & teams** —
  [Contributing Personas & Teams](extensions-authoring.md#contributing-personas--teams).
- **Publish it** — share it through the marketplace:
  [Publishing](extensions-authoring.md#publishing-to-a-marketplace-registry).
