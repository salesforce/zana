# Repo health triage — 2026-07-31

Scheduled health sweep: stale branches, oversized working-tree files, broken docs
links. Follows up [`repo-health-2026-07-30.md`](repo-health-2026-07-30.md) (last run
yesterday).

**TL;DR — branch backlog partly worked off, `main` still stale locally, file-size
concerns unchanged, docs still clean.** 25 local branches are fully merged into
`origin/main` and safe to delete (5 pinned by live worktrees — remove those first).
`main` is now **28 commits behind `origin/main`** (up from 24 yesterday — still not
pulled). No new broken docs links. `global.css` / `index.ts` sizes are unchanged from
yesterday's flag — still worth a splitting pass, not yet acted on. One stray untracked
git worktree (`.claude/worktrees/main-check`, 25 MB, detached at a 5-day-old commit)
should be removed — it isn't part of the repo and isn't pinning anything useful.

## 1. Stale branches

**Local — merged into `origin/main`, safe to delete (25):**

| Branch | Notes |
|---|---|
| `feat/chat-ambient-aurora-grid` | merged |
| `feat/chat-empty-state` | merged |
| `feat/chat-experience-upgrades` | merged (new since 07-30) |
| `feat/chat-native-upgrades` | merged |
| `feat/editor-settings-section` | merged |
| `feat/extension-git-install-and-consent-flow` | merged |
| `feat/install-ext-from-git` | merged |
| `feat/interactive-questions-toggle-in-agents` | merged |
| `feat/list-context-menus` | merged |
| `feat/llm-provider-settings-editor-style` | merged |
| `feat/opencode-harness` | merged |
| `feat/trust-zcc-tools-default-on` | merged (new since 07-30) |
| `feat/voice-dictation-waveform` | merged |
| `fix/composer-dictate-position` | merged |
| `fix/gui-path-repair-dotfile-installers` | merged (new since 07-30) |
| `fix/harness-toggle-live-state` | merged (new since 07-30) |
| `fix/readme-latest-release-link` | merged |
| `fix/remote-fs-connect-timeout` | merged |
| `fix/remove-agent-insights-cost` | merged |
| `fix/reports-tab-empty-flagged-report` | merged |
| `fix/settings-toggle-dead-fields` | merged (current HEAD branch — PR #143, merged 2026-07-29) |
| `pr/install-from-git` | merged |
| `chore/repository-cleanup` | merged — **pinned by worktree** at `/private/var/folders/.../T/opencode/zcc-cleanup-main` |
| `feat/add-local-project-manual-path` | merged — **pinned by worktree** `~/zcc-workspace/zana-add-local-project` |
| `feat/install-local-extension` | merged — **pinned by worktree** `~/zcc-workspace/zcc-install-local-ext` |
| `feat/opencode-resume-exact-session` | merged — **pinned by worktree** `/private/tmp/zcc-opencode-pr` |
| `feat/remote-dialog-hardcoded-path` (`fix/...`) | merged — **pinned by worktree** `~/zcc-workspace/zana-dev-remote-path-fix` |
| `feat/streamdeck-agent-kanban` | merged — **pinned by worktree** `~/zcc-workspace/streamdeck-hub-wt` (flagged yesterday too, still not removed) |

```
# unpin first (5 worktrees):
git worktree remove /private/var/folders/w2/zmzw89qx02z6lv7xl3nzb2cm0000gn/T/opencode/zcc-cleanup-main
git worktree remove ~/zcc-workspace/zana-add-local-project
git worktree remove ~/zcc-workspace/zcc-install-local-ext
git worktree remove /private/tmp/zcc-opencode-pr
git worktree remove ~/zcc-workspace/zana-dev-remote-path-fix
git worktree remove ~/zcc-workspace/streamdeck-hub-wt

# then prune all 25 merged branches (safe once main is current):
git branch -d feat/chat-ambient-aurora-grid feat/chat-empty-state feat/chat-experience-upgrades \
  feat/chat-native-upgrades feat/editor-settings-section feat/extension-git-install-and-consent-flow \
  feat/install-ext-from-git feat/interactive-questions-toggle-in-agents feat/list-context-menus \
  feat/llm-provider-settings-editor-style feat/opencode-harness feat/trust-zcc-tools-default-on \
  feat/voice-dictation-waveform fix/composer-dictate-position fix/gui-path-repair-dotfile-installers \
  fix/harness-toggle-live-state fix/readme-latest-release-link fix/remote-fs-connect-timeout \
  fix/remove-agent-insights-cost fix/reports-tab-empty-flagged-report fix/settings-toggle-dead-fields \
  pr/install-from-git chore/repository-cleanup feat/add-local-project-manual-path \
  feat/install-local-extension feat/opencode-resume-exact-session fix/remote-dialog-hardcoded-path \
  feat/streamdeck-agent-kanban
```

**⚠️ `main` is stale locally — 28 commits behind `origin/main`** (was 24 behind
yesterday — the gap grew, still not pulled). Run `git fetch && git checkout main &&
git pull` before trusting local `main` as a merge baseline.

**Active / leave alone (3, all unmerged into `origin/main`):**
- `feat/inbox-overhaul` — worktree at `~/zcc-workspace/zana-inbox-overhaul`, ahead 2,
  no open PR yet.
- `feat/terminal-settings-category` — ahead 1 of a *stale* local main; already
  **merged via PR #116 on 2026-07-26** as far as `origin/main` is concerned (its
  extra "ahead 1" commit — `init` — is noise, ignorable). Safe to delete once
  confirmed, but left out of the auto-delete list above pending a manual glance since
  `git branch --merged origin/main` doesn't list it (an artifact of a divergent squash
  merge, not real unmerged work).
- `feat/chat-ruleset-gate` — current tip of in-progress work, no PR pushed yet.

**Stray untracked git worktree — not a branch, but adjacent noise:**
`.claude/worktrees/main-check` (25 MB) is a detached-HEAD checkout at `ea4fb56`
(2026-07-26, PR #120), sitting inside the project's own `.claude/` dir yet untracked
by git. It isn't pinning any branch and appears to be scratch space from a prior
"is main current" check that was never cleaned up. Recommend `git worktree remove
.claude/worktrees/main-check` (verify no uncommitted work inside first — checked here,
it's clean).

**Remote-only branches (`origin/*`):** ~40 present, ranging 2026-07-23 to
2026-07-30 (newest: `origin/feat/harness-model-routing`, `origin/release/1.0.8`). Not
inspected individually this run (per 07-30's note, out of scope for local hygiene).

## 2. Oversized / notable files

| File | Size | 07-30 baseline | Verdict |
|---|---|---|---|
| `src/renderer/styles/global.css` | 30,492 lines / 722 KB | 30,492 lines | 🔴 unchanged — still flagged, no splitting pass yet |
| `src/main/index.ts` | 8,152 lines / 360 KB | 8,151 lines | 🔴 unchanged (+1 line) |
| `src/shared/types.ts` | 6,595 lines / 292 KB | 6,594 lines | ⚠️ unchanged |
| `src/renderer/store.ts` | 5,904 lines / 236 KB | 5,904 lines | ⚠️ unchanged |
| `src/main/pty.ts` | 2,826 lines / 144 KB | 2,826 lines | steady |
| `examples/extensions/zana/renderer.js` | 467 KB | — | built/bundled artifact, expected large |

Binaries unremarkable, same set as 07-30 (demo gifs ×2 at 1.4 MB, app icons ~1.2 MB /
808 KB, `package-lock.json` 606 KB) — nothing new or pathological.

No growth in the flagged files since yesterday's sweep (working tree today is
dominated by settings/harness cleanup, not touching `global.css`/`index.ts`
significantly). Yesterday's recommendation to schedule a dedicated splitting pass for
both files still stands and hasn't been acted on — repeating it once more without
escalating further, since a third unchanged flag in a row would suggest it's not
prioritized rather than not noticed.

## 3. Broken docs links — 0 (after triage)

Re-ran the relative-link checker across 337 markdown files (up from 157 counted
yesterday — broader glob this run, including `.zcc/library/`). It flagged 43
candidates; all are the same three false-positive classes documented in
[`repo-health-2026-07-30.md`](repo-health-2026-07-30.md#3-broken-docs-links--0-after-triage):
website absolute routes, `website/content/docs/*.md` doc-tree-relative links (synced
copies handled by the site's link rewriter), and code-span/fence literals
(`` `module[hook](ctx)` `` in `CLAUDE.md`, JS object literals in
`docs/plans/2026-07-12-afl-borrowed-features.md`). No new genuinely-broken links.

## Summary

- **Act (cheap):** `git fetch && git pull` on `main` (28 behind, growing daily);
  remove 5 worktrees + `.claude/worktrees/main-check`, then prune 25+ merged local
  branches (commands above).
- **Still open (2 days running):** `global.css` (30.5k lines) and `index.ts` (8.2k
  lines) splitting pass — unchanged since 07-30, not yet scheduled.
- **Clean:** 0 real broken docs links.
- **New this run:** stray `.claude/worktrees/main-check` scratch worktree (harmless,
  just clutter) and `feat/terminal-settings-category` sitting in an ambiguous
  merged-but-not-detected state — both low-priority cleanup.
