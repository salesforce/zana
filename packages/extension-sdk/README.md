# @zana-ai/zcc-extension-sdk

Retired disk-extension contract (`extension.json`, `utilityProcess`,
`RendererEntry.activate`, permission broker).

**New plugins use [`@zana-ai/zcc-plugin-sdk`](../plugin-sdk).** Scaffold with
`zcc plugin new <name>` or **Create** in Plugins → Browse. The manifest is
`package.json` → `zcc`; the app entry is `definePluginApp`; the server entry is
`export default function plugin(zcc)`.

This package remains in the repo only so already-installed leftover extensions
can keep loading for one release. Do not start a new integration here.

See:

- https://github.com/salesforce/zana/blob/main/docs/extensions.md
- https://github.com/salesforce/zana/blob/main/docs/extensions-authoring.md
- https://github.com/salesforce/zana/blob/main/docs/extensions-sdk-reference.md
