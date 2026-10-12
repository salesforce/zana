# Pi provider

Zana launches the machine's installed [Pi coding agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) with `pi --mode rpc`. Pi 0.84.0 or newer is required. Native Pi packages and extensions load through that installed runtime, including extensions that register tools during `session_start`. Each package can require a newer Pi version independently; Zana does not implement package-specific tools.

The plugin manifest uses `server.ts` for the provider declaration. The historical `server.mjs` entry delegates to it. The daemon bundles `src/bridge/bridge.ts` into `zcc-pi-bridge.mjs`; the source checkout resolves the same bridge. The older embedded SDK bridge is no longer a launch entry. This plugin currently has no `zcc.host` artifact.

The bridge injects a small ZCC extension for Zana's dynamic tools and lifecycle channel. It merges those tools into Pi's active tool set, preserving native tools. Pi owns its user/project settings, package loading, authentication, and model inventory. Additional Zana skill roots are passed with `--skill`.

`src/delta-translation.ts` maps Pi events into Zana's thread timeline. Native extension tools use that same event path. Extension requests for select, confirm, input, and editor are forwarded as answerable pending interactions; noninteractive helper sessions cancel requests that have no UI handler.

`src/bridge/provider-maintenance.ts` probes `pi --version` and supports installation and update actions. A missing or unsupported CLI fails before model resolution with installation guidance.

## Environment

By default, the bridge launches `pi` from the host's `PATH`. `ZCC_PI_BRIDGE_COMMAND` selects another executable and `ZCC_PI_BRIDGE_ARGS` supplies a JSON array of initial arguments. The version probe uses the same executable. Historical `BB_PI_BRIDGE_COMMAND` / `BB_PI_BRIDGE_ARGS` remain compatibility inputs; canonical values take precedence.

The declaration names these variables for host environment passthrough. Names travel through the server and daemon contracts; values are read on the execution host and restored only for that bridge process. Other inherited `ZCC_*` and `BB_*` variables remain scrubbed. Explicit bridge environment values take priority.

The **Trust system certificates** plugin setting (on by default) starts Pi sessions with `NODE_USE_SYSTEM_CA=1`, so Pi also trusts the OS certificate store. An app launched from the Dock never reads shell rc files, so `NODE_EXTRA_CA_CERTS` is usually missing, and providers behind a corporate TLS root fail with "Connection error.". Trusting the store adds to Node's bundled roots, so public providers are unaffected. A `NODE_USE_SYSTEM_CA` value already in the environment takes precedence. Changing the setting rebuilds a running session on its next turn. The model-catalog child always uses the default because it makes no model requests.

## Verification

Run the plugin's Vitest suite and TypeScript check, then `pnpm test:e2e -- e2e/pi-extension-loading.spec.ts`. The Electron test launches the pinned Pi CLI outside the fixture's isolated home, executes a native extension tool alongside injected Zana tools, checks a complete 36 KB Unicode result through the UI, and verifies missing-CLI errors.

To test an installed newer CLI and native SF-pi, set `ZCC_E2E_PI_CLI` to its `dist/cli.js` and `ZCC_E2E_SF_PI_DIR` to the package directory. The fixture loads that package into isolated settings and calls native `sf_apex author.plan` without org access or deployment. `ZCC_E2E_EXECUTABLE_PATH` can select a packaged Zana executable for the same tests.
