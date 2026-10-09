# settings-search-plugins (fixtures)

Disposable, test-only plugins for the Settings search E2E (`e2e/settings-search.spec.ts`).
Never ship these under `plugins/` or to the marketplace.

| Dir | Purpose |
| --- | --- |
| `normal/` | `zcc.settings.define` with a string, a select, a number and a boolean setting. Searching its label, description, options or current value must land on the plugin page `#plugin-configure`. |
| `secret/` | One `secret: true` setting plus one normal setting. Searching the secret's value (`fixture-values.json` → `secretValue`) must return nothing; its label and description stay searchable. |

`fixture-values.json` is the single source for the strings the E2E types and
seeds, so the spec and the plugins cannot drift.

Each plugin is a single `package.json` + `server.ts` (no panel). Install them by
path through the same install flow as any local plugin (see `e2e/README.md` and
`e2e/fixtures/plugins/platform-hooks-probe`). Plugin ids come from the install,
so the spec must read them back instead of hard-coding them.
