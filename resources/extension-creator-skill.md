---
name: extension-creator
description: Author a local Zana Command Center extension — the manifest schema, the renderer panel API (activate/host/React), the permission model, and the build/reload loop. Use when building or editing an extension inside the app's Extension Creator.
---

# Building a local Zana extension

You are editing the **source** of a local extension inside its working directory
(under `~/zcc-workspace/extensions/<id>`). The app scaffolded a starter template
here. You edit the source; the **app** packs and installs it — you never write
the installed copy directly, and you never leave this directory.

## The loop

1. Read the scaffolded files: `extension.json`, `dist/renderer.js`, `README.md`.
2. Ask the user what the extension should do.
3. Implement it in `dist/renderer.js` (and edit `extension.json` for
   title/icon/permissions as needed).
4. Call the `install_local_extension` tool (server: `zcc-inbox`) to pack and
   install your current source — the same effect as the user clicking
   **Reload from source** in the Extensions hub, but triggered by you the
   moment you have something worth testing. It re-packs your source (manifest +
   `dist/` only) and reinstalls it through the normal trust gates; the panel
   reloads live. It takes no arguments — it always targets the one extension
   you're working in. The first call prompts the user to approve it, like any
   other tool with a real side effect.

There is **no build step** for the renderer-only starter — `dist/renderer.js` is
plain ESM the host imports directly. Edit it and reload.

## Starter kinds

The create dialog offers four starter kinds, along the trust ladder. The app
scaffolds ONE of them into this dir; check the manifest to see which you have.

- **`panel`** — renderer-only UI. `permissions: []`, no backend. The default and
  simplest: everything lives in `dist/renderer.js`. Installs consent-free.
- **`main-panel`** — a panel **plus a main-process backend** (`dist/main.mjs`).
  The backend exposes capabilities the panel calls via `host.call(...)`. Ships
  with `permissions: ["exec"]` scoped to `git` (a `gitVersion` capability), so it
  trips the consent prompt on install — the deliberate teaching moment for the
  backend/permission model.
- **`mcp-consumer`** — a panel + backend that talks to a host-managed **MCP
  server** via `ctx.mcp(...)`. Ships `permissions: ["mcp"]` with a **placeholder**
  `mcpAllowlist` id you MUST replace with a real server id (see its `CLAUDE.md`).
- **`agent-preset`** — contributes a reusable **Quick-Agent preset** (its
  `agentPreset` block IS the feature; no backend). `permissions: []`. Edit the
  `systemPrompt` to define the agent's role.

The backend kinds (`main-panel`, `mcp-consumer`) put BOTH `main.mjs` and
`renderer.js` under `dist/`, because packing ships the manifest + `dist/` only.

### The backend module (`dist/main.mjs`)

A main module runs **headless** in its own process with **no raw Node access**
(`child_process`/`fs`/`net` are deprived). It reaches the OS only through the
brokered `ctx` capabilities, each gated deny-by-default against your manifest
permissions:

```js
export default {
  id: 'my-tool-a1b2',
  setup(ctx) {
    return {
      // Reached from the panel as host.call('gitVersion').
      async gitVersion() {
        try {
          const { stdout, code } = await ctx.exec({ bin: 'git', args: ['--version'] });
          return code === 0 ? { ok: true, version: stdout.trim() } : { ok: false };
        } catch (err) {                    // spawn failure / denied / timeout
          ctx.log('gitVersion failed', err);
          return { ok: false, error: String(err) };
        }
      }
    };
  }
};
```

- `setup(ctx)` returns a **capability map**; the renderer calls each via
  `host.call('<name>', ...args)`. Return values cross IPC by structured clone —
  keep them JSON-serialisable (plain data, no functions/class instances).
- **Never throw across the wire.** Catch inside the capability and return an
  `{ ok: false }` shape so the panel renders an honest failure.
- `ctx.exec({ bin, args, cwd?, timeoutMs? })` runs an **allowlisted** binary with
  no shell. `ctx.mcp(serverId, tool, args, opts)` calls an allowlisted MCP server
  and REJECTS when it's unavailable — catch and degrade to an empty result.

## `extension.json` (the manifest)

```jsonc
{
  "id": "my-tool-a1b2",          // minted by the app — DO NOT change it
  "version": "0.1.0",             // bump on meaningful changes
  "title": "My Tool",             // sidebar label
  "icon": "Puzzle",               // any lucide-react icon name
  "description": "What it does.",
  "author": "You",
  "entry": { "renderer": "dist/renderer.js" },
  "engines": { "zccApi": "^1.0.0" },
  "permissions": []               // start empty; add only what you use (see below)
}
```

- **Never change `id`** — it is the install-dir name, the storage namespace, and
  the local-registry key. Changing it detaches the extension from its records.
- `icon` is resolved against `lucide-react`. Pick an existing icon name (e.g.
  `Puzzle`, `Sparkles`, `Ticket`, `Workflow`, `Gauge`).
- To add a per-project tab (in addition to the sidebar entry), add
  `"projectTab": { "label": "My Tool", "icon": "Puzzle", "order": 200 }`.
- To contribute a **framework preset** to the Advanced Quick-Agent launcher, add
  an `"agentPreset": { "systemPrompt": "…" }` block (see below). `systemPrompt` is
  required — it's injected into a fresh Claude session via `--append-system-prompt`
  so the agent boots understanding your framework.

## The renderer panel

`dist/renderer.js` exports a default object with an `activate` method. The host
injects **its own** React and a capability bridge (`host`). Use the injected
React — never import or bundle your own (hooks break if you do).

```js
export default {
  activate({ React, host }) {
    const { createElement: h, useState, useEffect } = React;
    return function Panel() {
      const [items, setItems] = useState([]);
      useEffect(() => {
        // host.listProjects(), host.call(...), host.storage.*, etc.
        setItems(host.listProjects());
      }, []);
      // Root fills the host slot (full width + height) and owns its scroll.
      return h('div', { style: { height: '100%', overflow: 'auto', padding: 24 } }, /* … */);
    };
  }
};
```

`activate` may instead return `{ panel, settingsPanel, commands, navBadge }` to
also contribute command-palette entries, a sidebar badge, and a `settingsPanel`
component that surfaces in Settings → Extensions as this extension's settings
page (mounted with the same `{ host }` prop) — all optional. A bare component
return is treated as `{ panel }`.

### Layout — fill the panel

The host mounts your panel into a slot that already **fills the whole content
area** (full width + full height), same as the built-in views. Your panel's
**root element must fill that slot**: set `height: '100%'` (or `flex: 1`) plus its
own `overflow: 'auto'`, and `boxSizing: 'border-box'` if the root has padding.

- A fixed-width or content-sized root renders **cramped**, with dead space beside
  it — the classic "extension squished into a narrow column" bug. This is the #1
  layout mistake; the root is the one element that must always span the full slot.
- Use an inner `max-width` only where **reading width** matters (long prose),
  never on the root.
- You do NOT need to know the app's grid/column layout — the host owns placement
  (it's identical for the global sidebar surface and the per-project tab). You
  only own filling the slot you're given.

### Settings panel

Return `settingsPanel` alongside `panel` to give the extension its own config
page under **Settings → Extensions**. It's a normal component receiving the
same `{ host }` prop:

```js
return { panel: Panel, settingsPanel: Settings };
```

Two things differ from `panel`:

- **Where it mounts.** The hub stacks your `settingsPanel` in a scrolling
  detail column beneath the auto-generated About + Permissions cards — it is
  NOT the full-height content slot. Size the root to its content; do **not**
  set `height: '100%'` here (that's only for `panel`). This is the opposite of
  the fill-the-slot rule.
- **It's a separate mount.** `panel` and `settingsPanel` don't share React
  state. To share a value (e.g. a user preference the panel reads and the
  settings page edits), persist it with `host.storage.*` (add the `storage`
  permission) — don't try to lift state between the two.

A settings-only extension is valid: return just `{ settingsPanel }` for a
config-only tool. If you ship no `settingsPanel`, the hub shows a generic
About card and 'This extension does not expose any settings.'

### The `host` bridge (`ModuleHost`)

Commonly available (see `@zana-ai/zcc-extension-sdk` `ModuleHost` for the full surface):

- `host.moduleId` — this extension's id.
- `host.toast(msg)` — show a toast.
- `host.listProjects()` / `host.getActiveProject()` — project info.
- `host.getScopedProjectId()` — the project id when mounted as a project tab, or
  `null` in the global sidebar view. Read it to filter data per-project.
- `host.storage.get(key)` / `host.storage.set(key, value)` — persistent KV
  (requires the `storage` permission).
- `host.call(method, args)` — invoke a brokered main-side capability.
- `host.on(event, cb)` — subscribe to a host event (`project:changed`,
  `session:updated`, …). **Auto-disposed on unmount** — no manual unsubscribe
  needed (returning the `off()` from a `useEffect` still works).
- `host.register(fn)` — hand the host a cleanup thunk (clear a timer, close a
  socket) to run on unmount, exactly once. Use it instead of tracking teardown by
  hand; safe even if you also call it yourself.
- `host.confirm/quickPick/prompt/notify/withProgress` — host-rendered dialogs so
  you never build one. Promise-based; cancel resolves `false`/`null`.

Reaching host **outside React** (a module-level store or helper that can't take a
`host` prop): call `primeModuleHost(host)` inside `activate`, then read
`getModuleHost()` (returns `null` before activate — null-check) from the non-React
code — both from `@zana-ai/zcc-extension-sdk/renderer`. Don't hand-roll a host holder;
panels keep using the `host` prop.

Style with the app's theme CSS variables so you match light/dark automatically.
The defined ones (see `src/renderer/styles/global.css` `:root`):
`var(--text-primary)` (body text), `var(--text-muted)` (secondary text),
`var(--border)`, `var(--bg-panel)`, `var(--accent-blue)`. Always pass a literal
fallback for anything else, e.g. `var(--surface-2, rgba(127,127,127,0.06))`.

### Controls — use host picklists, not native selects

The desktop app intentionally uses themed, searchable picklists instead of
platform-native `select` menus. Native selects can open in the operating
system's light palette, do not scale well to the user's project/persona lists,
and make an extension feel detached from the rest of the app.

- **For a choice from a changing or potentially long list** (projects, people,
  teams, saved records, providers), render a semantic button that opens
  `host.quickPick(...)`. The host renders the searchable picker, owns Escape and
  focus return, and follows the app theme. Treat `null` as cancel; an empty
  string may be a valid selected value.
- **For two to four fixed, mutually exclusive modes**, use a visible button group
  with `aria-pressed` on the selected button. Do not hide a small decision behind
  a menu.
- **For booleans**, prefer a real checkbox inside a label. Do not make a `div`
  clickable. If a visual switch is essential, use a `button` with
  `role="switch"` and `aria-checked`.
- **For free-form values**, use a labelled `input` or `textarea`; do not force a
  picklist where typing is clearer. Every visible field needs a programmatic
  label, and disabled/unavailable choices need nearby explanatory text.
- **Never import core renderer internals** such as `PopoverPicklist` or copy its
  CSS into a disk extension. Those are host implementation details, not the
  extension API. Use `host.quickPick` for selection and the documented theme
  variables for your own layout.

Example: a project choice that matches host interaction instead of rendering a
native menu. This assumes the extension declared `projects:read`.

```js
function ProjectPicker({ projectId, onChange }) {
  const projects = host.listProjects();
  const selected = projects.find((project) => project.id === projectId);

  const chooseProject = async () => {
    const next = await host.quickPick(
      [
        {
          label: 'Active project',
          description: 'Use whichever project is currently selected',
          value: ''
        },
        ...projects.map((project) => ({
          label: project.name,
          description: project.remote ? project.remote.host : project.path,
          value: project.id
        }))
      ],
      { title: 'Project', placeholder: 'Search projects' }
    );
    if (next !== null) onChange(next);
  };

  return h(
    'button',
    {
      type: 'button',
      onClick: () => { void chooseProject(); },
      'aria-haspopup': 'dialog'
    },
    selected?.name ?? 'Active project'
  );
}
```

Use `host.confirm(...)` before a destructive choice, and use `host.prompt(...)`
for one short text value. This keeps extension dialogs consistent with the rest
of the app instead of recreating modal, focus-trap, and theme behavior.

Because disk-extension renderers receive only injected React and `host`, do not
assume you can import the host's React components. `host.quickPick` is the
supported public selection primitive; its items accept `{ label, description,
value }` and resolve to the selected `value` or `null` on cancel.

## Permissions (deny-by-default)

The starter declares **no permissions**, so it installs consent-free. Add a token
to `permissions` ONLY when you actually use the matching capability. Each addition
re-triggers the app's consent prompt — tell the user to approve it. Tokens:

- `storage` — persistent KV via `host.storage.*`.
- `projects:read` — read the project list / active project.
- `projects:select` — switch the selected project.
- `session:launch` / `session:reply` — launch / reply to Claude sessions.
- `external:open` — open web links.
- `inbox:push` — post to the inbox.
- `exec` — run allowlisted CLI tools (scope via `permissionScopes.execAllowlist`).
- `fs:read` / `fs:write` — read/write allowlisted folders
  (`permissionScopes.fsRoots`, absolute or `~/…`).
- `net` — reach allowlisted hosts (`permissionScopes.egressAllowlist`).

Example scoped block:

```jsonc
"permissions": ["fs:read", "net"],
"permissionScopes": {
  "fsRoots": ["~/notes"],
  "egressAllowlist": ["api.github.com"]
}
```

`execAllowlist` and `egressAllowlist` accept `"*"` (any tool / any host) as an
explicit "I can't enumerate these" grant — the consent screen shows it as
unrestricted. `fsRoots` has **no** wildcard: filesystem access is always an
enumerated list.

## Sharing your extension

To share an extension so a peer can install it, publish it to a **git repo** and
they install it via **Settings → Extensions → Install from repo…** (paste the
repo URL). The app clones it, shows the permissions it requests, and installs on
their approval — the same consent + broker as any install.

The **"Prepare for sharing"** button (Extensions hub, on a local extension)
assembles a clean, git-ready export under `<workingDir>/share`: the installable
bytes (manifest + `dist/`) plus a generated README with the install one-liner. It
does NOT git init/commit/push — the user commits + pushes that dir themselves.
`share/` is a sibling of your source and is never packed into the install, so a
prepared export can't recursively include itself. Re-run it after edits; it
rebuilds the dir each time.

If the repo has the manifest in a **subfolder** (e.g. a monorepo), the installer
takes an optional "Subfolder" path. If it finds multiple `extension.json` files
one level down, it asks the installer to specify which.

## Do / don't

- **Do** keep everything inside this working directory.
- **Do** call `install_local_extension` and verify the panel actually renders
  after installing, before claiming done.
- **Don't** change the manifest `id`.
- **Don't** try to write directly into `~/.zcc/extensions` — always go through
  `install_local_extension` (or ask the user to click "Reload from source").
- **Don't** add a permission you don't use.
