# ZCC Runtime Applications

The runtime follows a server-host split while preserving ZCC's authorization
boundary: renderer and host daemon submit intent; the server authorizes and
commits durable state.

| Application | Responsibility | Current migration status |
| --- | --- | --- |
| `app` | React product UI and local-only presentation state | Compatibility facade over the existing renderer while routes/components move incrementally. |
| `server` | Product policy, durable state, plugin host (in-process `PluginService`), and event hub | Serves the packaged renderer and plugin app assets, loads installed plugins in-process, and issues authenticated, HMAC-signed execution commands; current Electron main remains the compatibility authority during extraction. |
| `host-daemon` | Server-authorized PTY, harness, workspace, and watcher execution | Runs only token-authenticated, server-signed, unexpired launch commands and returns bounded events; existing PTY manager is migrated capability by capability. |
| `desktop` | Electron window, preload, updater, native menus, and runtime supervision | Supervises loopback renderer and host services, then loads the renderer from the trusted server origin while retaining the preload compatibility bridge. |
| `web` | Marketing, documentation, marketplace, and download site | Pending physical relocation from `website/`; do not change its Docker deployment concurrently with runtime transport. |

No app may import another app's implementation source. Cross-app dependencies
must flow through workspace packages, and extensions may import only the public
extension SDK.
