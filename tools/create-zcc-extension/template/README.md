# {{TITLE}}

A Zana Command Center (ZCC) extension.

## Layout

```
extension.json          manifest the host loader reads (id, icon, entry, engines)
src/renderer/panel.tsx  RendererEntry — default-exports { activate } (uses INJECTED React)
src/main/index.ts        optional MainModule — named capabilities reached via host.call()
vite.config.ts          library-mode build: one entry in, one ESM out
dist/                    build output (renderer.js / main.js) — what gets installed
```

## Build

```sh
npm install
npm run build      # writes dist/renderer.js and dist/main.js
```

The default panel uses injected React and `React.createElement`, so it has no
runtime React import. If you add JSX or a UI library, use host-React shims and
bundle the UI library instead of relying on bare external React imports.
The main build externalizes Electron and Node built-ins, but disk extensions must
not import raw Node APIs:
use the permission-gated `ctx.exec`, `ctx.fs`, and `ctx.fetch` capabilities.

## Install

The host discovers extensions under `~/.zcc/extensions/<id>/`. Copy the
manifest plus the built bundles into a directory named for your `id`:

```sh
ID=my-extension
DEST=~/.zcc/extensions/$ID
mkdir -p "$DEST"
cp extension.json "$DEST"/
cp dist/renderer.js "$DEST"/
cp dist/main.js "$DEST"/      # only if you ship a main module
```

The on-disk shape the loader expects:

```
~/.zcc/extensions/my-extension/
  extension.json
  renderer.js
  main.js           (optional)
```

(`extension.json` `entry.renderer` / `entry.main` are filenames relative to that
directory — they must match the files you copied in.)

## Dev loop

1. Edit `src/`.
2. `npm run build`.
3. Re-copy `dist/*` + `extension.json` into `~/.zcc/extensions/<id>/`.
4. Enable the extension in ZCC (Settings → Extensions). Toggling enable causes a
   relaunch so the new bundle is imported fresh.

> Permissions in `extension.json` are enforced deny-by-default for disk
> extensions. Declare only the capabilities your extension uses; a permission
> requiring a scope also needs the matching `permissionScopes` allowlist.
