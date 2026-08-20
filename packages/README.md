# ZCC Workspace Packages

Workspace packages are intentional boundaries, not a directory for arbitrary
shared code.

- `domain`: product vocabulary with no Electron, React, persistence, or PTY dependencies.
- `contracts`: serializable validated messages across process boundaries.
- `ui`: host-owned generic React primitives and semantic tokens; not an extension API.
- `zcc-app`: curated packaged runtime composition only.
- `extension-sdk`: public, semver-versioned external extension surface.
- `harness-sdk`: dependency-free harness descriptor surface.

Only `@zana-ai/zcc-extension-sdk` is public today. Every other package remains
private until ZCC explicitly commits to its compatibility policy.
