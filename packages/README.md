# ZCC Workspace Packages

Workspace packages are intentional boundaries, not a directory for arbitrary
shared code.

- `domain`: product vocabulary with no Electron, React, persistence, or PTY dependencies.
- `contracts`: serializable validated messages across process boundaries.
- `ui`: host-owned generic React primitives and semantic tokens; not an extension API.
- `zcc-app`: curated packaged runtime composition only.
- `plugin-sdk`: public, semver-versioned plugin surface (`ZccPluginApi`, `definePluginApp`).
- `extension-sdk`: deprecated compatibility re-exports during the `extension.json` shim window.
- `harness-sdk`: dependency-free harness descriptor surface.

`@zana-ai/zcc-plugin-sdk` is the public plugin contract. `@zana-ai/zcc-extension-sdk`
remains only as a shim-window re-export. Every other package remains private until
ZCC explicitly commits to its compatibility policy.
