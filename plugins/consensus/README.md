# Consensus

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

`react`, `react-dom`, `react/jsx-runtime`, and `lucide-react` are externalized in
the renderer build — the host injects its own React via `activate({ React, host })`.
A second React copy in the bundle breaks hooks. `electron` and Node built-ins are
externalized in the main build.

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

> Permissions in `extension.json` are **declared, not enforced** today (curated-
> trust phase). Declare what you intend to use; enforcement lands in a later phase.
