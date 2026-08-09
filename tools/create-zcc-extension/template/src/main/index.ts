/**
 * Optional main-process entry for a ZCC extension.
 *
 * `setup` returns a map of named capabilities. The renderer reaches each one via
 * `host.call('<name>', ...args)`. Disk extensions run in an isolated child; use
 * the permission-gated `ctx` capabilities for OS access. Keep capabilities
 * data-in / data-out because return values cross IPC and must be JSON-serialisable.
 *
 * The build externalizes `electron` and Node built-ins, but disk extensions must
 * not use raw Node APIs. Everything else the extension imports is bundled. Delete
 * this file (and the `entry.main` field in extension.json) for a renderer-only
 * extension.
 */
import { defineMainModule } from '@zana-ai/zcc-extension-sdk';

export default defineMainModule({
  id: 'my-extension',
  setup(ctx) {
    return {
      async ping(name: string) {
        ctx.log(`ping(${name})`);
        return { pong: true, name, at: Date.now() };
      },
    };
  },

  // Optional lifecycle hooks — sandboxed, capability-gated (same `ctx` as
  // `setup`), NOT npm-style shell scripts. Delete the ones you don't need.

  // Fired ONCE, right after the first `setup` following an explicit install
  // (never on boot/reload). First-run provisioning: seed storage, write a
  // starter config under a granted fs root.
  // async onInstall(ctx) {
  //   ctx.storage.set('installedAt', new Date().toISOString());
  // },

  // Fired ONCE while the extension is still live, before teardown + removal, on
  // an explicit uninstall. Clean up state that lives OUTSIDE the extension dir.
  // Your `ctx.storage` KV is purged by the host automatically — no need to clear
  // it here.
  // async onUninstall(ctx) {
  //   ctx.log('cleaning up before uninstall');
  // },

  // Release in-process resources acquired in `setup` (timers, watchers, sockets).
  // Fired on disable / uninstall / hot-reload.
  // teardown() {},
});
