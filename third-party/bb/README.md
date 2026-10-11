# BB-derived changes

ZCC adapts code and tests from [get-bb/bb](https://github.com/get-bb/bb), licensed
under the MIT license reproduced in [LICENSE](./LICENSE).

The September 22, 2026 update reviewed BB through commit
`18960354e462d514c0d6071ba1ed0f8f2acd625c`. In particular:

- `5ba6e4917204c558af711515b57801e80df91ce9`: structured path matching and tests in `packages/fuzzy-match`.
- `48bc6a7e9c8819a62ff3d486c803ff186e3afe55`: Codex writer-lock retry logic and process test fixtures in `plugins/provider-codex/src/bridge`.
- `0613621b39d26008bd406bd7a9c6401a3faaa358`: browser machine-selector resolution and regression cases in `plugins/browser-automation`.

Other behavioral adaptations and their ZCC-specific implementations are recorded
in [the update report](../../docs/bb-upstream-update-2026-09-22.md).

## Tasks and plans parity (2026-09-22)

`plugins/tasks` ports the Tasks source and tests from the local BB checkout at
`9e16411141788c67954bceb753bb64ac1dc7057f`. Its `vendor/shared-ui` directory contains
the transitive UI components consumed by that plugin. The MIT license in this
directory applies to these copied files. `compat/` adapts Zana's public plugin SDK,
including opaque host ids, binary HTTP, navigation, model selection, and thread lifecycle.
Zana additionally migrates its former KV board and retains its durable Plan document
and revision UI; provider checklist snapshots now reconcile rather than accumulate.

## Provider correctness and prompt reuse (2026-10-06)

The October 6 update reviews BB through `985a267f363f9339472ae3175f49b73efb6f3329`.
Provider source and protocol tests adapt the following upstream work:

- Claude precise approvals (`4502eab4b`, `96c40f014`), Plan capabilities/sandbox
  (`94d704e71`, `5195fbba0`), and live permission updates (`44578f308`).
- ACP permission reconciliation (`84bfe4ba4`) and unexpected-exit recovery
  (`be68bf357`), including the OpenCode question environment (`1f73cd73c`).
- Codex permission-only continuity (`95750b884`) and native choice questions
  (`454392410`).
- Shared permission-change contract scenarios in `packages/provider-bridge-protocol`.

Zana-specific implementations also adopt the behavior of question drafts
(`11adf4884`), voice send/retry (`5c3c186fa`, `9dba0d472`), browser recovery
(`b3a8c0796`, `d916873bd`), portable attachments (`ddef378bb`), and Prompt Library
(`3c4d610fa`). The comparison and verification records are in
`.zcc/library/research/bb-upstream-review-2026-10-06.md` and
`.zcc/library/plans/bb-upstream-implementation-2026-10-06.md`.

## Performance adaptations (2026-10-06)

The follow-up reviews BB through `a8a9ee86696677586854766f4f1dcb4e7f831a78`.
Zana applies indexed per-thread tip lookups to roster unread counts (#4931),
skips nested work when projecting conversation outlines (#4718), and suspends
hidden split-pane timeline reads (#4511). A bounded outline snapshot cache
preserves edits, rewinds, and writes from other database connections. Optional
Settings pages now load on navigation rather than during initial shell loading,
following the bundle-boundary approach in #4512. The measurement and verification
record is `.zcc/library/findings/bb-performance-adaptations-2026-10-06.md`.

## Upstream fixes (2026-10-10)

The October 10 update reviews BB through `3912f4aaefb7dff55c7e0cb5003b26b5cf1457dc`.
Zana adapts the following upstream fixes:

- Providers: a separate timeline row for each Codex sub-agent follow-up (`5b757139f`),
  disabled Codex reasoning (`be17db2d3`), changed ACP model, effort and tier on
  follow-up turns (`eb3d8956d`, `2eba81bc6`), applied to both
  `packages/provider-bridge-acp` and the built-in ACP plugin bridge, the construction
  deadline for session restore (`04c6371b8`), and Claude plugin UI notifications
  classified as noise (`a0fe13536`).
- Background work: event-history pruning that visits only changed threads (`9d9a094ed`,
  implemented in Zana with SQLite triggers feeding a work queue), and workflow queue
  claims that wake on change instead of polling (`67869c0e6`).
- Desktop and app: hidden browser media paused and muted (`f135a001e`), app API
  requests kept out of the HTTP cache (`488ec9ffb`), pending-interaction cards held
  busy after submit (part of `d16b7317a`), and file-preview reading offsets retained
  per panel tab (`bb5a62f3b`).
- Plugins: Ask User Question waits up to seven days (`849b7def3`), and Prompt Library
  keeps results during search (part of `c505f22e6`).

Zana needed additional changes for these fixes to hold:

- The seven-day question only works end to end because plugin worker calls carrying a
  caller's `AbortSignal` are bounded by the interaction ceiling, not the 120-second RPC
  deadline. Their signal slots are released when the call settles, so a long-running
  runtime no longer stops at 1,024 calls. Host tool-call responses stream whitespace
  heartbeats, so neither the daemon's 300-second fetch timeout nor the pairing relay's
  idle limit ends the wait. The question card closes when the agent's call is torn down.
- Hidden automation browser tabs are muted but not paused, because an agent may be
  driving their media.
- An ACP follow-up turn re-applies only the model, effort or tier that changed. It fails
  when the agent refuses a changed model, instead of running on the old one.
- The workflow worker's maintenance pass makes a read-only check for queued runs that
  nothing woke it for. Retention checks for a due run through an index before running
  the ancestry query.

The triage record is `.zcc/library/research/bb-upstream-review-2026-10-10.md`.

## Subsystem ports (2026-10-11)

These adapt BB subsystems reviewed at `3912f4aaefb7dff55c7e0cb5003b26b5cf1457dc`:

- Queued-message editing (`dcc61a285`). Opening a queued message for editing holds it
  in the deferred queue. The hold lease is capped at two minutes, and the drain stops at
  a held message so later messages keep their order.
- Per-thread notification levels and readable previews (`ba5a4c546`, `59a1fcc29`,
  `d48bb915a`). Zana builds these into core instead of a plugin. Levels are stored with
  the thread's metadata, and the mobile relay asks the server for a verdict before it
  sends. Error notifications keep generic text.
- GitHub CLI credentials forwarded to remote machines (`1ca5e0923`, `60eed057d`). Zana
  implements this in the GitHub plugin over a generic remote-environment seam, with a
  manifest allowlist of variable names. A machine's own values always win. The credential
  helper is scoped to github.com, so helpers for other hosts keep working. The commit
  identity and the SSH-to-HTTPS remote rewrite are opt-in settings, because an
  environment identity overrides a machine's `user.name` and `user.email`.
- Storage & retention (`7fe037e42`, `0e4540c2d`). This is a built-in plugin that is
  installed disabled, and every policy defaults to Never. Retention clears a thread's
  files but never deletes the thread. Deletion runs on the machine, confined to its
  thread-storage directory.
