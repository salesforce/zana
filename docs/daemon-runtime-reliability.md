# Daemon recovery and installation diagnostics

The desktop's product server and execution daemon run as separate Electron utility processes. An unexpected exit rejects outstanding work, makes subsequent IPC calls fail immediately, and offers **Restart Zana** or **Keep open**. Restarting is deliberate because it ends surviving agents. Failed project-list requests must not be presented as an empty project list.

A utility process can remain alive after its enrolled execution connection stops.
For example, overflowing the host event sink's 32 MiB / 16,384-event queue stops
the connection and its runtimes to avoid losing authoritative history. This is
not a utility-process exit, so it does not trigger the desktop crash dialog.
When the primary machine is disconnected, the Modern and CLI Agent composers
offer **Restart host daemon** through the same authorized recovery API as
Settings → Development. The action preserves the prompt, disables duplicate
requests while restarting, reports failures inline, and disappears when the
host roster reconnects. Remote targets retain their own install/repair action
even when the primary machine is offline. A terminated utility process still
requires **Restart Zana**.

Remote daemon upgrades download at most 16 MiB, expand at most 64 MiB, and enforce a 30-second network deadline. Only the four flat host-bundle files are accepted; links and unexpected entries are rejected. A staged executable must pass an exit-status protocol probe before the stable `runtime/join.mjs` symlink is changed atomically. Companion bundles stay in the same generation. The previous executable is retained until the replacement completes its server handshake; startup failure rolls back the pending generation. Failed attempts use bounded exponential backoff.

Service installations set `ZCC_HOST_SERVICE_MANAGED=1`; their manager restarts the stable entry. Background-only installations spawn a replacement and refresh `host-daemon.pid`. Repair stops launchd/systemd first. An unmanaged PID is signalled only if its command and start time still match the expected daemon. Desktop lock takeover also requires a recorded matching process identity. A live legacy PID-only lock requires stopping its owning app or service; it cannot safely be killed automatically.

Enrolled connections use BB's PartySocket/`ws` stack on both legacy relay and
Connect paths. A failed upgrade retries with 1–30 second exponential backoff;
each connection and readiness handshake has a 10-second deadline. An installed
standalone daemon keeps retrying during an initial outage, including when the
protocol updater is temporarily unavailable. Desktop enrollment waits remain
bounded at 60 seconds. Shutdown cancels a pending startup and releases its lock. Accepted sessions exchange heartbeats every five seconds
with a 30-second lease. Missing replies force reconnection, and the server
removes peers whose heartbeats stop. Reconnection preserves the daemon lifetime
and machine credentials; temporary network errors never consume a join code.

Readiness is a two-phase exchange. `host.hello-ok` supplies plugin generations;
the daemon reconciles them, then sends `host.ready` with its bounded runtime
inventory. The server acknowledges readiness before releasing Stop or queued
requests. A reconnect of the same daemon lifetime restores surviving work,
settles completed work, and retains failures. A new process cannot restore the
old process's work. Stop intent survives disconnect grace until it can be
delivered. Inventory entries are confined to the authenticated host's threads
and their existing environments. Internal provider-health runtimes are excluded;
repeated readiness failures use a bounded retry delay rather than a tight loop.

Close code 4003 retires a superseded daemon; 4004 replaces only a stale socket
of the same lifetime. A superseded service-managed process stops its runtime
and keeps only its local status listener until an explicit restart, because
existing launchd/systemd installations restart clean exits too. This prevents
two service managers from repeatedly replacing one another.

Repair tries restarting any existing installation before reinstalling. On
machines without launchd/systemd, `join.mjs restart` uses the saved enrollment
and verifies the recorded lock owner before replacing the process. Restart also
prepends the selected Node executable directory to PATH for child tools. This is a
background process, not a boot service: a machine reboot still requires its
environment to start the daemon. A version-38 daemon already stranded by the
native Node 22 WebSocket bug needs a one-time restart/update after the desktop
with protocol 39 is installed.

Core warnings and errors are recorded under the data directory's `logs/` in `desktop.log`, `server.log`, and `host-daemon.log`. Each role keeps three files, approximately 2 MiB each, with private file permissions, credential redaction and a bounded write queue. The startup record includes the runtime executable and Node/Electron versions; a streamed SHA-256 fingerprint identifies the actual bundle even when release versions are equal. Logging errors never block startup. These diagnostics do not capture terminal transcripts or arbitrary object graphs. Sudden OS kills may lose the last queued log messages; the surviving desktop records utility failure.

## Dependency maintenance

DOMPurify is pinned to 3.4.16 and older transitive uuid versions are overridden with compatible CommonJS-capable 11.1.1. `decode-uri-component@0.2.2` has a committed pnpm patch backporting the upstream 0.5.0 bounded decoder while retaining CommonJS and plus-to-space handling.

Two version-based audit alerts can still be returned:

- [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): the decoder patch is verified with a large malformed input and compatibility cases in `scripts/dependency-security.test.ts`.
- [GHSA-cp6q-959q-f8rh](https://github.com/ueberdosis/tiptap/security/advisories/GHSA-cp6q-959q-f8rh): the resolved Tiptap 2.27.3 package already defines `__proto__` as an own data property. `plugins/tasks/tiptap-security.test.ts` verifies its prototype and ProseMirror DOM serialization. Do not force a Tiptap major upgrade solely to hide this version-range alert.

The audit alerts are not globally suppressed. Recheck these exceptions when the upstream packages or patches change.

## Verification

- `apps/server/src/http/host-reconnection.integration.test.ts` covers delayed readiness, pending Stop, same-lifetime runtime reconciliation, malformed readiness and superseded ownership.
- `e2e/machine-reconnection.spec.ts` runs the served bundle through failed upgrades, missing hello/heartbeat acknowledgements and an unmanaged restart with a startup outage longer than 60 seconds. It verifies the Machines UI and unchanged saved credentials.

- `apps/server/src/services/hosts/host-self-update.integration.test.ts` starts a real bundled daemon speaking the previous protocol, serves the current artifact, and proves replacement/handshake for both restart ownership modes.
- `e2e/runtime-recovery.spec.ts` kills only an isolated app's server/daemon, verifies the recovery dialog and persisted projects, and probes the served daemon artifact from Electron.
- `e2e/composer-daemon-recovery.spec.ts` stops an isolated app's enrolled connection by authenticated supersession, then verifies both composer recovery actions, preserved drafts, reconnection and reuse of the live Electron utility process.
- `e2e/runtime-isolation.spec.ts` verifies SQLite while Node and Electron preparation run concurrently.
- Run `pnpm test:e2e -- e2e/runtime-recovery.spec.ts e2e/runtime-isolation.spec.ts` for a private production build.
- Run live launch and Memory suites from a host shell, with `ZCC_SERVER_URL` set explicitly when both production and development apps are running. A missing Memory plugin is a missing validation prerequisite, even if the suite reports passed tests after returning early.
