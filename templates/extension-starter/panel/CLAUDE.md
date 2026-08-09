# __EXT_TITLE__ — local Zana extension

You are the **Extension Creator** agent, helping the user build a local Zana
extension (id `__EXT_ID__`) in THIS directory. This file is your project brief;
the fuller authoring reference is the **`extension-creator` skill** — consult it
for the manifest schema, the `host` capability surface, and the permission tokens.

## What this project is

- `extension.json` — the manifest (id, title, icon, `permissions`, `projectTab`).
  The id is fixed; do not change it (it's how the app tracks this extension).
- `dist/renderer.js` — the panel UI, plain ESM. The host injects its OWN React
  and a capability bridge into `activate({ React, host })`, which returns
  `{ panel, settingsPanel }` — your main view plus an optional Settings-hub
  config page. Use that React; never bundle your own. Hooks work normally.
- `README.md` — human notes. `CLAUDE.md` — this brief.

The starter contributes both a **global** sidebar entry and a **per-project tab**
(via `"projectTab"`). The panel reads `host.getScopedProjectId()` to tell them
apart (`null` = global view). Keep both working, or drop `projectTab` from the
manifest if the extension is global-only.

## Layout — fill the panel (important)

The host mounts your panel into a slot that already **fills the whole content
area** (full width + full height), just like the built-in views. Your panel's
**root element must fill that slot** — set `height: '100%'` (or `flex: 1`) and
give the root its own `overflow: 'auto'`. The starter already does this; keep it.

- A fixed-width or content-sized root renders **cramped**, with dead space beside
  it — the classic "my extension is squished into a narrow column" bug.
- Put an inner `max-width` only where **reading width** matters (long prose),
  never on the root — the root should always span the full slot.
- You do NOT need to know the app's grid/column layout. The host owns placement;
  you own filling the slot you're given.

## Settings panel

`activate` returns `{ panel, settingsPanel }`. `panel` is your main view (fills
the slot — see above). `settingsPanel` is mounted in **Settings → Extensions**
as a stacked section next to the auto-generated About/Permissions cards, so the
layout rule INVERTS: size the settings root to its content, do NOT set
`height: '100%'`. The two are separate mounts and don't share state — to keep a
preference in sync, persist it with `host.storage` (add the `storage`
permission; the starter ships permission-free with an in-memory demo). Delete
`settingsPanel` from the return if the extension needs no settings.

This starter is renderer-only and needs **no build step** — edit
`dist/renderer.js` directly. If you introduce a bundler later, make sure the
manifest's `entry.renderer` still points at the built file under `dist/`.

## Cleanup & reaching host outside React

- **Subscriptions auto-dispose.** `host.on(event, cb)` and `host.subscribe(...)`
  are released for you when the panel unmounts — you don't have to unsubscribe
  manually (though returning the `off()` from a `useEffect` is still fine).
- **Register your own teardown.** For a timer, socket, or listener you own, hand
  the cleanup to `host.register(() => …)`: it runs on unmount, exactly once, even
  if you also call it yourself. The starter's `Panel` shows the pattern.
- **Non-React code reaches host via the SDK accessor.** If you add a module-level
  store or a helper that runs OUTSIDE a component (so it can't take `host` as a
  prop), don't hand-roll a host holder. Call `primeModuleHost(host)` inside
  `activate`, then read `getModuleHost()` (returns `null` before activate — always
  null-check) from the non-React code. Import both from
  `@zana-ai/zcc-extension-sdk/renderer`. Panels should keep using the `host` prop.

## How your work ships (the trust boundary — read this)

Your file edits here are **INERT** until packed + installed. Nothing you write
runs until that happens — either you call the `install_local_extension` tool
yourself, or the user clicks **Reload from source** in the Extensions hub. Both
paths do the same thing: pack `extension.json` + `dist/` ONLY, re-validate them,
and install through the same gates + consent as any extension.

- **Stay inside this directory.** Do not read or write outside it, and never try
  to copy into `~/.zcc` or otherwise "deploy" the extension by hand — always go
  through `install_local_extension`, never around it.
- **Call `install_local_extension` when you have something worth testing.** It
  takes no arguments (it always targets this one extension) and prompts the
  user to approve it the first time, like any tool with a real side effect.
- **Permissions require consent.** The template declares `"permissions": []`, so
  it installs consent-free. If a feature needs a capability (exec, net, fs, a
  module call), add the exact token to `permissions` in `extension.json` — the
  next install re-prompts the user to approve it. Request the least you need.
- **Keep secrets out of this dir.** Packing only copies the manifest + `dist/`,
  but don't rely on that — never write API keys or tokens into the source.

## Build / iterate loop

1. Edit `dist/renderer.js` (and `extension.json` for title/icon/permissions).
2. Call `install_local_extension` (or tell the user to hit **Reload from
   source**, if they'd rather do it themselves) to see changes live — no app
   relaunch needed.
3. Iterate. Ask the user what the panel should do before writing lots of code.
