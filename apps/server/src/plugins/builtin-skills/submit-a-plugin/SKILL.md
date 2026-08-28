---
name: submit-a-plugin
description: Submit a Zana Command Center plugin to the community marketplace. Use when the user asks to submit, list, publish, or add a plugin to the marketplace, or asks for a marketplace pull request.
---

# Submit a plugin

Submit a public plugin to the community marketplace through a pull request.

The marketplace lists **pointers only** (npm package + range, or git URL +
ref). Refresh never executes plugin code. The plugin source stays in its Git
repository or npm package.

## Start with current contracts

1. Open the plugin repository and read `package.json`.
2. Confirm `engines.zcc`, `engines.zccPluginSdk`, and the `zcc` block
   (`name`, `description`, `branding`).
3. Derive the plugin ID from the package name by stripping a `zcc-plugin-`
   prefix (same algorithm as `derivePluginId`).
4. Run the plugin's tests, `zcc plugin build`, and `zcc plugin types --check`.

Ask the user for the community marketplace git repository if none is
configured (`zcc marketplace ls`). Add one with
`zcc marketplace add <https-index-url>`.

Read these files from the marketplace default branch before you write an entry:

- `README.md`
- `schema` / index schema matching `packages/domain/src/plugin-marketplace.ts`
- two or more current entries

Treat those files as the source of truth.

## Prepare the entry

An entry is provenance, not a bundle:

```json
{
  "id": "notes",
  "displayName": "Notes",
  "description": "A notes panel for Zana Command Center.",
  "author": { "name": "Ada", "github": "ada" },
  "source": {
    "git": { "url": "https://github.com/ada/zcc-plugin-notes", "ref": "v1.0.0" }
  }
}
```

Use `source.npm` (`package` + `range`) when the plugin is published to npm.

Do not copy plugin source into the marketplace repo.

## Open the pull request

Use the author's `gh` auth. Do not expose tokens, npm credentials, or private
URLs.

1. Fork or clone the marketplace repo.
2. Add the entry + icon following existing files.
3. Validate the index against the schema.
4. Open a PR. Summarize what the plugin does and that install is full-trust
   in-process on the server.

Stop before each release mutation until the user approves the exact tag or
npm publish.
