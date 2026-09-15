# Official Zana plugin marketplace

Pointer-only catalog for first-party plugins. Refresh never executes plugin code;
install resolves each entry's `source.git` or `source.npm`.

This registry is the **source of truth** for the public feed served at
`/marketplace/v1/marketplace.json` on the Zana website.

## Layout

| Path | Role |
| --- | --- |
| `marketplace.base.json` | Marketplace identity (`name: official`, display name, description) |
| `entries/<plugin-id>.json` | One listing per official plugin |
| `schema/marketplace.schema.json` | JSON Schema for the built manifest |
| `scripts/build.mjs` | Validates entries and writes the built feed |
| `marketplace.json` | Built manifest (also copied to `website/content/marketplace/`) |

## Add or update an official listing

1. Ensure the plugin lives under `plugins/<id>/` (or point `source` at the real install location).
2. Add or edit `entries/<id>.json`. The file name stem must equal the entry `id`.
3. Run the build:

```bash
node marketplace/scripts/build.mjs
# or
npm run build --prefix marketplace
```

4. Commit the entry file **and** the regenerated:

- `marketplace/marketplace.json`
- `website/content/marketplace/marketplace.json`

Website `predev` / `prebuild` also run this build.

### Entry shape

```json
{
  "id": "memory",
  "displayName": "Memory",
  "description": "Short summary for the browse list.",
  "overview": "Optional longer markdown for the detail pane.",
  "icon": { "lucide": "Brain" },
  "tags": ["official"],
  "author": {
    "name": "Zana",
    "github": "salesforce",
    "url": "https://github.com/salesforce/zana"
  },
  "source": {
    "git": {
      "url": "https://github.com/salesforce/zana",
      "subdir": "plugins/memory",
      "ref": "HEAD"
    }
  }
}
```

Use `source.npm` (`package` + `range`) when the installable package is on npm instead of this monorepo.

## Consume the feed

```bash
zcc marketplace add https://<PUBLIC_BASE_URL>/marketplace/v1/marketplace.json
zcc marketplace install memory@official
```

Desktop builds seed the official catalog from `ZCC_OFFICIAL_MARKETPLACE_URL` when that env var is an `https://` URL.

## Tests

```bash
npm test --prefix marketplace
```
