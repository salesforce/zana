# Releasing plugin changes

Plugins registered by the host in `apps/server/src/plugins/builtin-registry.ts`
ship with Zana. This includes optional official plugins offered in Browse.
Their delivery channel is the normal Zana application release.

For a bundled plugin change:

1. Update the plugin and bump its package version when its behavior changes.
2. Run its focused tests and `pnpm verify:fast`.
3. For runtime or packaging changes, run the packaged-provider startup E2E.
   For authoring changes, also run the plugin-authoring E2E and bundled CLI tests.
4. Build and package Zana through the normal application release process. The
   packaging step includes compiled plugin runtimes and declared runtime assets.
5. After users install the Zana release, server startup reconciles installed
   bundled plugins against those shipped runtimes. Disabled and uninstalled
   choices, plugin settings, and stored data are preserved.

Merging a plugin change, publishing an npm package, or refreshing a catalog
does not replace bundled code on existing installations. Independent packages
cannot claim a reserved bundled identity. Test bundled plugins from local source
with **Settings → Development → Bundled plugin development**
enabled, or the host's startup development flag. Saved Settings choices take
precedence over the startup flag.

Independent Git/npm plugins can release separately. Publish a new npm version or
Git release within the source selector users installed. Declare compatible
`engines.zcc` and `engines.zccPluginSdk` ranges in `package.json`. For monorepos,
keep the installed subdirectory and tag prefix stable. Users receive availability
checks automatically and apply compatible updates explicitly in Plugins or with
`zcc plugin update <id>` / `zcc plugin update --all`. Exact version, commit, and
tag installs stay pinned; immutable Git tags must never be moved.

Catalog changes affect discovery and new installations. Installed independent
plugins keep their recorded source, selector, registry, and subdirectory even if
their catalog entry changes or disappears.

Release qualification must also exercise the signed packaged application on each
supported desktop platform. The repository's isolated built-Electron tests are
development evidence and do not replace that installer gate.
