# Independent Salesforce plugin

Salesforce and Agentforce Studio are maintained in https://github.com/grebmann1/zcc-plugin-salesforce. The official Plugins catalog points to its compiled `runtime` branch; immutable `v*` release tags are available for pins. The source, feature tests, build inputs and release automation live in that repository. The core no longer ships its source, runtime, toolkit or Salesforce CLI setup check.

Fresh profiles install Salesforce explicitly from Plugins. Existing `builtin:salesforce` registrations migrate to the registered independent repository on startup. The plugin id, installed-at timestamp, enabled flag, tool policy, settings and storage remain stable. A failed download keeps the prior registration and retries on a later reconciliation. Failed candidate activation uses the existing durable activation journal and data rollback. When the previous app bundle is gone and downloading is unavailable, stored data remains intact but Salesforce cannot run until the independent runtime is downloaded.

Only the registered repository may claim the externalized identity remotely. Explicit local path installs remain supported for development. The old `builtin:salesforce` install spelling redirects to the registered repository so saved installation instructions continue to work. Independent Git installs retain normal version pins, update checks and recovery behavior. Uninstall remains respected and does not trigger a new automatic install.

Rollout order: publish and verify the independent compiled release, update the official catalog, then ship this core migration. Existing Zana versions that still reserve Salesforce as bundled may reject a direct independent install; upgrade to the Zana release containing this transition first.
