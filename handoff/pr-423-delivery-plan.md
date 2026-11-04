# PR #423 Fix — Delivery Squad Handoff (orchestrator, read fully)

You are the **Delivery Squad orchestrator**. This project IS the PR #423 worktree, already on branch `feat/design-doc-sync-ui`. You coordinate and delegate; you do not write code or run shell yourself.

PR: https://github.com/salesforce/zana/pull/423

## Startup (do these in order)
1. Read BOTH review sources in full and treat EVERY item as in-scope:
   - PR review comment: `gh pr view 423 --json comments,reviews` (12 numbered gaps + "smaller items").
   - File-level guide: `/Users/geoffrey.baker/Downloads/fix-guide-salesforce-zana-423.md` (~250 findings).
2. Register the DAG below via `execution_plan_register` using this run's executionId: translate U1–U23 into workUnits with their `dependencies`, `files` (for write-lock safety), and `routing.minimumLevel`. Pin `minimumLevel:high` on U11,U12,U13,U14,U15,U16,U20,U23. Then call `work_dispatch_ready`.
3. Coordinate engineer + reviewer workers to execute the DAG.

## HARD RULES
- **Do NOT push** until U23 (the final unit), and only after `pnpm verify:full` is green locally. The push + CI-watch is U23 and nothing else pushes.
- Respect repo root `AGENTS.md` and every nested `AGENTS.md` in a dir you touch — read before editing.
- **80% changed-code coverage** (AGENTS rule 8): add/adjust tests with each code change.
- **Rule 6**: core must not name a concrete extension id; no bare `'zana'` literal in `apps/app/src/**`.
- **File write-locks**: never dispatch two writers to the same file at once. Units sharing a file are serialized via deps. `sync-store.ts` is ONE unit (U17).
- Address EVERY item from BOTH sources — nothing dropped.

## User decisions baked in
- Peers UI is **global**. The experimental `peersSettingsEnabled` gate is intentionally **removed**, not wired.
- `apps/app/src/views/settings/SettingsView.peers-gate.test.tsx` is correct (Peers visible without opt-in) — keep it.
- Security-critical units are **pinned minimumLevel:high**.

---

## Work-unit DAG

### Phase 1 — ungate Peers (SERIAL, gates everything)
- **U1** (medium · `apps/app/src/views/settings/PeersSettingsView.tsx`): add `h3` "Peers" heading that `e2e/fixtures/peer-apps.ts:219 openCorePeers()` waits for. deps: none.
- **U2** (medium · `packages/domain/src/product.ts`): remove dead `peersSettingsEnabled?: boolean` (~:2357). deps: none.
- **U3** (medium · `e2e/fixtures/peer-apps.ts`): remove stale `corePeerConfig`/`peersSettingsEnabled` usage. deps: U2.
- **U4** (medium · `e2e/settings-preferences-layout.spec.ts`): rewrite from hidden-until-opt-in + "Show Peers in Settings" to global-visibility contract. deps: U1.
- **U5 VERIFY** (medium): `pnpm test:e2e -- e2e/core-peer-pairing.spec.ts e2e/settings-preferences-layout.spec.ts`. deps: U1,U2,U3,U4. **Everything below deps on U5.**

### Phase 2 — coverage (parallel, after U5)
- **U6** (medium · `apps/app/src/lib/peers-visibility.ts` + new test): cover `pluginSupportsPeers`. deps: U5.
- **U7** (medium · `apps/app/src/views/settings/settings-navigation.ts` + test): cover `visibleSettingsSections` branches. deps: U5.
- **U8** (medium · `apps/app/src/lib/product-client.ts` + test): cover `peerConnections`. deps: U5.
- **U9** (medium · `apps/server/src/http/product-context.ts` + test): cover changed branches incl. dispose/callback. deps: U5.
- **U10 VERIFY** (medium): `pnpm verify:fast` + changed-coverage script. deps: U6,U7,U8,U9.

### Phase 3 SECURITY — PINNED HIGH (after U5; each unit owns its file set)
- **U11** (HIGH · `apps/server/src/services/peers/peer-invitation.ts`): stop embedding private `bootstrapSeed` in invitation token (:568-575); verify authTagLength. deps: U5.
- **U12** (HIGH · `apps/desktop/src/runtime/runtime-supervisor.ts`): peer boot key must not pass via env (:453). deps: U5.
- **U13** (HIGH · `apps/server/src/services/peers/peer-replay-window.ts`): per-pair replay budget, not shared store (:43). deps: U5.
- **U14** (HIGH · `plugins/design-docs/server.ts`): restore fence must fail-closed, not warn-and-continue (:70-79). deps: U5.
- **U15** (HIGH · guide ERROR set: join-standalone peer.control, `hosts.ts` listHosts, `store.ts` expectedHead, plugin-worker-bridge AsyncFunction fence, peer-ssh-endpoints race): read guide for exact files/lines. deps: U5. If any file overlaps U11-U14, serialize behind it.
- **U16** (HIGH · `apps/host-daemon/src/peer-tunnels.ts`): TMPDIR temp-key cleanup on crash (:216). deps: U5.

### Phase 3 LOGIC — medium (after U5; sync-store SERIAL — same file)
- **U17** (medium · `plugins/design-docs/src/server/sync-store.ts`): gaps #3 (10k Sync Now), #5 (manual-session retention + consent compare), #7 (op-row prune), retry cap (:1381-1382). **SINGLE UNIT — sole owner of sync-store.ts.** deps: U5.
- **U18** (medium · `plugins/design-docs/src/server/peer-group.ts`, `plugins/design-docs/src/server/peer-slots.ts`): active-seat cap must not count historic members. deps: U5. (distinct files from U17 — parallel-safe)
- **U19** (medium · `packages/db/src/migrate.ts`): migration v35/v36 ordering (:498-530). deps: U5.
- **U20 VERIFY** (HIGH): targeted vitest for all Phase-3 files + `live:*` triggers per AGENTS verification table (peers / design-docs / host-daemon seams). deps: U11-U19.

### Phase 4 — style/test-quality (after U10 & U20, lowest priority)
- **U21** (low/medium · remaining guide INFO/WARNING: 50-line fn splits, magic-number constants, logging, non-blocking missing test files across ~90 files): batch mechanically, respect existing conventions. deps: U10,U20. Split across engineers by directory (no shared files).

### Finalize (SERIAL, last)
- **U22** (medium · `plugins/design-docs/app.js`, `plugins/design-docs/server.mjs`): rebuild design-docs bundles (PR-comment gap #2) AFTER all src edits land. deps: U21.
- **U23 FINAL** (HIGH): `pnpm verify:full` locally. Only if green: push, then watch all checks (`gh pr checks 423`) and diagnose-and-repair per AGENTS rule 9 until every required check passes. deps: U22. When green, call `complete_autonomous_run` with a summary.

## Coverage map (nothing dropped)
- PR comment gap #1 → U1-U4 · #2 → U22 · #3/#5/#7 → U17 · #4 → U14 · #6 → U18 · #8 → U13 · #9 → U19 · #10 → U16 · #11/#12 → confirm against guide, land in U17/U18.
- smaller items: TMPDIR → U16 · shared replay → U13 · authTagLength → U11 · migration order → U19.
- Guide ERROR → U15 (+ overlaps into U11-U14) · WARNING logic → U17-U19 · WARNING coverage → U6-U9 · INFO → U21.
- CI fails: boundary → U1 · coverage → U6-U9 · typecheck-gate → clears with the above.
