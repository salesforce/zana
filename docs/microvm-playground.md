# microVM Playground

A **sandboxed execution playground** a native (host-side) agent drives from
_outside_ over MCP. The agent runs natively on the host — fully authenticated,
model call included — and hands _only execution_ to an isolated libkrun microVM:
clone a repo, `npm install`, run untrusted code, compile, test, all inside a VM
with its own kernel + network namespace that cannot touch the host filesystem.

This is the **inverse** of launching an agent _inside_ the guest (the `microvm`
execution environment, `harness/microvm-environment.ts`). Running the agent
in-guest hits the SF model-gateway auth wall (the gateway is a VPN-only address
unreachable from the guest netns). The playground sidesteps that entirely: the
model call stays on the authed host, only the sandboxed command runs in the VM,
so **there is no auth question**.

## Architecture

```
  host (native agent, full auth)              isolated libkrun guest
  ------------------------------              ----------------------
  claude / codex / ...                        alpine (or node/ubuntu)
    |  microvm_exec(projectId, cmd)  ------->    /bin/sh -c "<cmd>"
    |  microvm_reset(projectId)                  own kernel + netns
  MicroVmPool (src/main/microvm/pool.ts) --->    NO host bind mount
```

- **`MicroVmPool`** (`src/main/microvm/pool.ts`) — the trusted core subsystem
  (Rule 7: the only playground module touching the microsandbox SDK). A twin of
  `zana/mcp-pool.ts`: persistent guests keyed by `projectId`, lazily booted,
  bounded (`maxGuests` = 4, LRU-evicted), idle-TTL reaped (10 min), per-command
  timeout (120 s default, max 600 s), commands serialized per guest, disposed
  once on shutdown (Rule 3). **State persists** across calls for a project —
  clone in one call, build in the next — because the same `Sandbox` object is
  reused.
- **`microvm_exec` / `microvm_reset`** (`src/main/microvm-exec-mcp-tool.ts`) —
  the MCP surface (twin of `remote_exec`). `microvm_exec(projectId, command, {
  network?, timeoutMs? })` runs a command and returns `{ exitCode, stdout,
  stderr, truncated }` (non-zero exit is data, not an error; streams clipped at
  1 MB). `microvm_reset(projectId)` wipes the guest so the next call boots a
  clean one.

## Security model (Rule 1 / 2 / 7)

- **No host bind mount.** A hostile repo runs on the guest's own scratch disk
  and cannot see host files. File exchange (planned, PR-C) is explicit and
  audited via `copyToHost` / `copyFromHost`, never an ambient mount.
- **Image is authorized against a closed allowlist** (`resolveAuthorizedImage`,
  no `"*"`). An agent's `image` hint can only _select_ an allowlisted option
  (alpine / ubuntu / node / python), never define a registry ref.
- **Fails closed.** Feature disabled, unsupported platform (Intel Mac / no
  KVM/WHP), SDK absent, or a boot failure all resolve to `{ ok:false, message }`
  — an honest empty state, never a crash (`MicroVmUnavailableError`, mirrors
  `McpUnavailableError`).
- **Not pre-approved.** Like `remote_exec`, the first call raises a one-time
  permission prompt; it is auto-allowed **only** on an autonomous team run
  (where a blocking prompt would stall an unattended fleet).

## Enabling it

The playground rides the same master switch as the launch-isolation feature:
enable **`microVmEnabled`** in Settings (default OFF). The pool re-reads this
flag on every call, so toggling it takes effect without a restart. On an
unsupported platform the tools stay wired but every call returns an honest
"unsupported platform" failure.

Requires **Apple Silicon** (macOS arm64), Linux-KVM, or Windows-WHP — same
platform constraint as the launch-isolation microVM. `microsandbox` is an
optional native dependency loaded lazily, so a build without the addon (or an
Intel Mac) is unaffected until a guest actually boots.

## Live test

The pool has an opt-in live test that boots a **real** microVM and drives the
whole chain (boot -> persist -> isolate -> separate-guest -> reset -> dispose,
plus `network:"none"` isolation). It is skipped unless explicitly opted in:

```sh
# From the repo root, with microsandbox installed + ~/.microsandbox provisioned:
ZCC_MICROVM_LIVE=1 npx vitest run src/main/microvm/__tests__/pool.live.test.ts
```

The fake-SDK unit tests (`pool.test.ts`, `microvm-exec-mcp-tool.test.ts`) run in
the normal suite with no addon.

## Known non-blocking limitation

On the SF corp-VPN box, `git clone github.com` fails **in-guest**: `github.com`
resolves to a VPN-only CGNAT address on the host, and the guest resolver returns
NXDOMAIN for it. Public hosts (example.org, package registries via Fastly/CDN)
and internal git resolve fine. This is a corp-network fact, not a VM limitation.
