# Plugin Testing

Backend unit tests use `createFakePluginHost` from `@zana-ai/zcc-plugin-sdk/testing`; call `harness.callRpc` and `harness.runCli`. Fake host does not prove layout, routing, or crash boundaries. Prefer `storage.kv`; fake `storage.database()` is in-memory.

App tests use `loadPluginApp` and `renderSlot` from `@zana-ai/zcc-plugin-sdk/testing/app`. Load with thunk, inspect `slot.inspection.rpcCalls` and `navigateCalls`, then call `slot.lifecycle.unmount()`.

For live verification, read scaffold `AGENTS.md` and `LIVE_TEST.md`; run `zcc status --json`, install path plugin, run `zcc plugin dev --once` after edits, open actual slot through `cua.getApp("Zana")`, perform main action, reload visible source edit, and verify already-open panel updates. Inspect `zcc plugin logs <id> -n 50`. UI build or health check never proves mounted UI. Preserve supplied session credentials and never modify installed app or registry to bypass toolchain failures.
