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
