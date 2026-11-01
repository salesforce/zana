# Plugin quickstart

```
zcc plugin new hello --app    # ./zcc-plugin-hello
cd zcc-plugin-hello
zcc plugin install .
zcc plugin dev
```

That writes `package.json` (with a `zcc` block), `server.ts`, optional `app.tsx`,
and `skills/hello/SKILL.md`. Path installs load `server.ts` from source. Start
Zana, then `zcc plugin ls` should show `hello` as running.
`zcc plugin logs hello -f` tails persisted JSONL.

Edit `app.tsx` (panel, project tab, project menu) while the app is running —
`plugin dev` rebuilds and remounts without a restart. Open **Plugin Guide** under
Plugins for annotated wireframes of every surface, then the plugin’s **Plugins hub**
Configure page for settings and live Includes.

To work on bundled plugins under `plugins/`, enable **Settings → Development → Bundled plugin development**. The saved switch applies immediately:
it enables source watching and allows local path overrides of bundled plugin IDs.
Turning it off stops watching and blocks further overrides; currently loaded
plugins keep running. A saved choice overrides the startup default supplied by
`ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD=1`.

Official first-party plugins:

```
zcc plugin install builtin:docs
```

Docs is a builtin and auto-installs on boot.

See [`extensions-sdk-reference.md`](./extensions-sdk-reference.md) for slots and the
server API.
