# Repo health triage — 2026-07-30

Scheduled health sweep: stale branches, oversized working-tree files, broken docs
links. Follows up the prior run on 2026-06-29 (a one-month gap, so branch/size
drift below is larger than usual).

**TL;DR — clean on docs, overdue on branches.** 18 local branches are fully merged
into `main` and safe to delete (one is pinned by a live worktree — remove that first).
`main` itself is **24 commits behind `origin/main`** — pull before doing anything else.
Docs links are clean: the handful of `/docs/...` and `../tools/...` hits the checker
flagged are false positives (Next.js site routes and doc-tree-relative links in the
website's synced copy, both correct as written). `global.css` has grown to a striking
**30,492 lines** (~2× the 06-29 figure) and `src/main/index.ts` to 8,151 lines — both
worth a closer look, not just a "watch."

## 1. Stale branches

**Local — merged into `main`, safe to delete (18):**

| Branch | Notes |
|---|---|
| `feat/chat-ambient-aurora-grid` | merged |
| `feat/chat-empty-state` | merged |
| `feat/chat-native-upgrades` | merged (was ahead 10, now landed) |
| `feat/editor-settings-section` | merged |
| `feat/extension-git-install-and-consent-flow` | merged |
| `feat/install-ext-from-git` | merged |
| `feat/interactive-questions-toggle-in-agents` | merged |
| `feat/list-context-menus` | merged |
| `feat/llm-provider-settings-editor-style` | merged |
| `feat/opencode-harness` | merged |
| `feat/streamdeck-agent-kanban` | merged — **pinned by worktree** `~/zcc-workspace/streamdeck-hub-wt`, remove worktree first |
| `feat/voice-dictation-waveform` | merged |
| `fix/composer-dictate-position` | merged |
| `fix/readme-latest-release-link` | merged |
| `fix/remote-fs-connect-timeout` | merged |
| `fix/remove-agent-insights-cost` | merged |
| `fix/reports-tab-empty-flagged-report` | merged |
| `pr/install-from-git` | merged |

```
git worktree remove ~/zcc-workspace/streamdeck-hub-wt   # unpins feat/streamdeck-agent-kanban
git branch -d feat/chat-ambient-aurora-grid feat/chat-empty-state feat/chat-native-upgrades \
  feat/editor-settings-section feat/extension-git-install-and-consent-flow feat/install-ext-from-git \
  feat/interactive-questions-toggle-in-agents feat/list-context-menus feat/llm-provider-settings-editor-style \
  feat/opencode-harness feat/streamdeck-agent-kanban feat/voice-dictation-waveform fix/composer-dictate-position \
  fix/readme-latest-release-link fix/remote-fs-connect-timeout fix/remove-agent-insights-cost \
  fix/reports-tab-empty-flagged-report pr/install-from-git
```

**⚠️ `main` is stale locally — 24 commits behind `origin/main`.** Run `git fetch &&
git checkout main && git pull` before trusting local `main` as a merge baseline; the
merged-branch list above was computed against local `main` and could shift slightly
once you're current.

**Active / leave alone (11):** `feat/inbox-overhaul` (worktree,
`~/zcc-workspace/zana-inbox-overhaul`, ahead 2), `feat/terminal-settings-category`
(ahead 1), `fix/settings-toggle-dead-fields` (current branch), `feat/trust-zcc-tools-default-on`,
`chore/repository-cleanup` (worktree), `feat/opencode-resume-exact-session` (worktree),
`feat/chat-experience-upgrades`, `fix/remote-dialog-hardcoded-path` (worktree),
`fix/harness-toggle-live-state`, `fix/gui-path-repair-dotfile-installers`,
`feat/add-local-project-manual-path` (worktree) — all unmerged, recent (0–2 days), in-flight.

**Remote-only branches (`origin/*`):** ~50+ present, ranging 2026-07-01 to present.
Not inspected individually this run (out of scope for local hygiene) — worth a
separate remote-branch sweep if the origin is accumulating similarly.

## 2. Oversized / notable files

| File | Size | 06-29 baseline | Verdict |
|---|---|---|---|
| **`src/renderer/styles/global.css`** | **30,492 lines / 708 KB** | 16,259 lines | 🔴 nearly doubled — worth investigating, not just watching |
| **`src/main/index.ts`** | **8,151 lines / 360 KB** | 4,285 lines | 🔴 nearly doubled |
| `src/shared/types.ts` | 6,594 lines / 292 KB | 3,251 lines | ⚠️ doubled (type decls, lower risk) |
| `src/renderer/store.ts` | 5,904 lines / 236 KB | 3,624 lines | ⚠️ watch |
| `src/main/pty.ts` | 2,826 lines / 144 KB | — | new to this list |
| `src/main/__tests__/__snapshots__/pty-golden-argv.test.ts.snap` | 340 KB | — | expected (golden-argv net, per CLAUDE.md) |

Binaries are unremarkable and match the CLAUDE.md-documented asset set: demo gifs
(1.4 MB ×2, root + docs copy), app icons (~1.2 MB / 808 KB), `package-lock.json`
(596 KB). Nothing pathological there.

🔴 The doubling of `global.css` and `index.ts` in one month tracks with the volume of
in-flight feature branches (settings panels, chat upgrades, extension install flows —
all touch these two files per the working-tree diff). CLAUDE.md already flags
`global.css` as coupled to both the Tickets kanban and the `gus`/`zana` extension
panels — splitting the shared base out gets more expensive the longer this grows.
`index.ts` at 8k+ lines is now large enough that a module-boundary pass (it likely
still does IPC wiring + business logic inline per Rule 6/7 patterns) would pay for
itself in review-ability alone. Recommend flagging both for a dedicated splitting pass
rather than deferring again.

## 3. Broken docs links — 0 (after triage)

Ran a relative-link checker across **157 markdown files**. It flagged 48 candidates;
**all 48 are false positives**, three distinct kinds:

1. **Website absolute routes** (`/docs/getting-started/`, `/download/`, etc.) in
   `docs/using-zana.md`, `docs/getting-started.md`, and their `website/content/docs/`
   mirrors — these are Next.js site routes (`website/app/docs/[slug]/page.tsx`), not
   filesystem paths. Correct as written.
2. **Doc-tree-relative links inside `website/content/docs/*.md`** (`../tools/...`,
   `./extensions-sdk-findings.md`, etc.) — these files are synced verbatim from
   `docs/*.md` by `website/scripts/sync-docs.mjs`, which copies the raw markdown; the
   site's `lib/docs.ts` link-rewriter handles `./slug.md` → `/docs/slug/` and silently
   degrades anything else (an unpublished doc, a repo path) to plain text at render
   time. Not a repo-hygiene issue — working as designed.
3. **Two literal-string false matches**: `` `module[hook](ctx)` `` in `CLAUDE.md` (code
   span, not a markdown link) and inline JS object literals like
   `{ action: { kind: 'start-terminal' } }` inside fenced code blocks in
   `docs/plans/2026-07-12-afl-borrowed-features.md` — the regex checker doesn't
   distinguish code spans/fences from prose links.

`README.md` itself: all 5 relative links resolve cleanly (demo gif, `docs/extensions.md`,
`docs/extensions-authoring.md`, `tools/create-zcc-extension`, `docs/cli.md`).

## 4. Working-tree note

Current branch `fix/settings-toggle-dead-fields` has substantial uncommitted work: repairs
to dead config toggles across `chat-manager.ts`, `chat-runner.ts`, `persona-store.ts`,
`zcc-harness/*` (gate, pi-backend, types, a new `ruleset.ts` + test), plus a new
`install-local-extension-mcp-tool.ts` + integration test and a library decision doc
(`.zcc/library/decisions/chat-ruleset-gate-2026-07-30.md`). Consistent with active
development, not a health concern — flagging only because it's a wide diff (18 modified
+ 5 new files) worth committing/splitting before it grows further.

## Summary

- **Act (cheap, your call):** `git fetch && git pull` on `main` (24 behind); remove
  the `streamdeck-hub-wt` worktree and prune 18 merged local branches (commands above).
- **Investigate (upgraded from "watch"):** `global.css` (30.5k lines, doubled in a
  month) and `src/main/index.ts` (8.1k lines, doubled) — both now large enough to
  warrant a splitting pass, not just monitoring.
- **Clean:** 0 real broken docs links (48 flagged, all false positives — website
  routes, synced-doc relative paths, or code-span/fence false matches).
- **No new regressions** since 06-29; the branch backlog is the main thing that's
  drifted from "clean" given the ~1-month gap since the last sweep.
