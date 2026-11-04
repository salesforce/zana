# Plugin packs

A plugin pack groups independently maintained plugins into one reviewed installation flow. Each plugin keeps its own release, settings, sign-in, enablement and update policy. A pack does not run code or add a sidebar destination.

## Install and manage a pack

1. Open **Plugins → Browse**, then choose **Review pack** on a pack card.
2. Review the members and their sources. Required members are included; optional members can be deselected. Plugins already installed are left as they are, including disabled plugins.
3. Choose **Install selected plugins**. The selected plugins run with the same full trust as individually installed plugins.
4. If a member fails, successful installations remain available. **Retry failed plugins** retries the failed members without updating or reinstalling members already present.
5. Open each plugin's settings to finish its own configuration and sign-in.

Packs appear in the installed Plugins collection. **Manage pack** reviews the current catalogue membership and links to each installed plugin's settings. A catalogue refresh can offer additional members, but installing those members always requires another review and installation action. Packs do not silently install new members or update existing ones.

**Forget pack** removes the saved grouping. Its plugins, settings and accounts remain installed. Remove an individual plugin through its own installation controls.

## Publish a pack

Keep the existing `marketplace.json` plugin catalogue unchanged. Add a sibling `packs.json` file:

```json
{
  "schemaVersion": 1,
  "packs": [
    {
      "id": "developer-essentials",
      "displayName": "Developer Essentials",
      "description": "Work accounts and developer environments, configured independently.",
      "icon": "Layers",
      "members": [
        { "pluginId": "work-accounts", "required": true },
        { "pluginId": "developer-environments", "required": true },
        { "pluginId": "optional-helper" }
      ]
    }
  ]
}
```

The example IDs must correspond to real entries in that same catalogue's `marketplace.json`. Members use catalogue plugin IDs, rather than arbitrary Git URLs or npm package names. A pack contains at most 32 unique members; nested packs and references to other marketplaces are not supported. `required` defaults to `false`.

Publish the sidecar alongside the catalogue at its configured HTTPS, Git or local path source. Older Zana versions continue consuming `marketplace.json`; pack-aware versions also discover the sidecar. Membership and installable sources are revalidated by the host when a user reviews and installs a pack. If catalogue metadata changes after review, the user must review the fresh plan before installing.

Use required members for the pack's core purpose, and optional members for useful additions. A pack is an installation convenience, not a runtime dependency declaration. Plugins that cannot function without another plugin should continue declaring their functional dependency through the plugin manifest.

## Verification

The focused backend and UI unit tests cover catalogue parsing, reviewed installation authority, persistence and member states. `e2e/plugin-packs.spec.ts` exercises the built Electron application with an isolated HOME, a synthetic catalogue and real local Git repositories. It verifies an existing disabled plugin is preserved, optional selection, partial failure and retry, saved plugin data, restart persistence, newly advertised members remaining uninstalled, and forgetting a pack without removing its plugins.

Run the production-boundary test with:

```sh
pnpm test:e2e -- e2e/plugin-packs.spec.ts
```
