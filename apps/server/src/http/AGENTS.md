# Host callback routes

A remote daemon reaches the product server only through closed route lists:

- the SSH pairing forwarder: `PAIRING_ALLOWLIST` in `pairing-allowlist.ts`
- the Connect relay: `services/mobile-relay/machine-routes.mjs`, copied to `website/relay/mobile/` by `node website/scripts/sync-mobile-relay.mjs`

A route served in `host-internal.ts` and called from `apps/host-daemon/src` but missing from either list is refused (403) before it reaches the server. Local machines never cross the forwarder, so unit tests and local runs pass while every remote machine fails. #713 shipped `/internal/hosts/native-tool-policy` this way, and the fail-closed veto then denied every remote tool call.

**When adding or renaming a `/internal/hosts/*` route:**

1. Add it to both lists, then run the sync script.
2. Run `apps/server/src/http/host-callback-routes.guard.test.ts`. It fails when a served or called route is missing from either list, or when the lists disagree.
3. Prove the daemon client reaches it through the real forwarder (see `pairing-forwarder.native-tool-policy.test.ts`).

**When the provider bridge sends the daemon a request an older daemon does not handle**, bump `HOST_RPC_PROTOCOL_VERSION` in `packages/contracts/src/host-rpc.ts` with a comment line. The server rejects an older daemon's hello and the daemon self-updates; without the bump, a freshly delivered plugin runs against the old daemon and fails closed.
