# Repo health triage — 2026-08-13

Scheduled health sweep: stale branches, oversized working-tree files, broken docs
links. Follows up [`repo-health-2026-07-31.md`](repo-health-2026-07-31.md) (13-day
gap — largest since the 06-29→07-30 one-month gap, so drift below is heavier than a
normal daily run).

**TL;DR — `main` is finally caught up, branch backlog ballooned, one stray worktree
still un-pruned, docs still clean.** `main` now equals `origin/main` exactly (was 28
commits behind on 07-31 — resolved). Local branch count grew from ~50 to **74**, and
remote branches to **147** — only 11 are provably merged into `origin/main` (5 of
those pinned by live worktrees), the rest are either abandoned WIP with no upstream or
tracked in a different PR system than this repo's `gh` (no open PRs at all, 37 total
ever recorded) — consistent with the OSS-republish setup ([[main/origin disjoint
history]] memory — no longer applies today, but explains why most branch history
here predates this remote). `global.css` shrank (30,492 → 28,072 lines) but
`src/main/index.ts` grew again (8,151 → 9,297 lines, +14%) — still worth a splitting
pass. The `.claude/worktrees/main-check` stray worktree flagged on 07-31 is still
sitting there, now 18 days stale. No new broken docs links.

## 1. Stale branches

**Local — merged into `origin/main`, safe to delete (11):**

| Branch | Notes |
|---|---|
| `docs/refresh-readme` | merged, no worktree — delete now |
| `feat/expandable-mermaid-diagrams` | merged, no worktree — delete now |
| `fix/home-launcher-and-remote-upload` | merged, no worktree — delete now |
| `fix/remote-launch-attachments` | merged, no worktree — delete now |
| `fix/remote-terminal-upload-root` | merged, no worktree — delete now |
| `fix/tool-activity-idle-veto` | merged, no worktree — delete now |
| `chore/consolidate-npm-updates` | merged, but pinned by worktree `/private/tmp/zana-npm-updates` |
| `fix/e2e-first-run-state` | merged, but pinned by worktree `/private/tmp/zana-oss-migration` |
| `fix/extra-args-text-field` | merged, but pinned by worktree `/private/tmp/zana-public-pr` |
| `fix/fix-with-ai-zcc-workspace-pr` | merged, but pinned by worktree at `.../T/zcc-fix-with-ai-pr` |
| `feat/editable-extension-sources` | merged; worktree `/private/tmp/zcc-editable-extension-pr` is **prunable** (dir already gone) — run `git worktree prune` then delete the branch |

Suggested cleanup, safe first pass:
```
git branch -d docs/refresh-readme feat/expandable-mermaid-diagrams \
  fix/home-launcher-and-remote-upload fix/remote-launch-attachments \
  fix/remote-terminal-upload-root fix/tool-activity-idle-veto
git worktree prune
git branch -d feat/editable-extension-sources
```
The other 4 merged branches need their pinning worktree removed first
(`git worktree remove <path>`) before `git branch -d` will succeed.

**Local — no upstream, not merged, likely abandoned WIP (10):** `chore/unify-release-hosting`,
`feat/agent-diff-full-branch-view`, `feat/home-agent-launcher`,
`feat/opencode-conversation-picker`, `feature/markdown-comments`,
`fix/core-hardening-reliability`, `fix/extra-args-text-field` (local-only copy,
distinct from the pinned one above), `pr/chat-rename-auto-report-linker`,
`worktree-inbox-conversation-brainstorm`. Several of these are pinned by their own
worktrees (`.claude/worktrees/chat-opencode-rework`,
`.claude/worktrees/inbox-conversation-brainstorm`, `zana-inbox-overhaul`,
`zana-markdown-comments`, `zcc-rebrand-zana`, `zana-dev-remote-path-fix`,
`streamdeck-hub-wt`) — worth a manual pass to confirm which are truly dead vs.
still-active side workspaces before deleting.

**Remote — merged into `origin/main`, candidates for `git push origin --delete` (11):**
same 11 names as the local-merged list above minus `feat/editable-extension-sources`'s
oddity — all 11 exist on `origin` too and are equally safe to prune remotely.

**Remote — 147 branches total, only 37 ever had a `gh` PR recorded (0 currently
open).** This repo's `gh` history is not authoritative for most of them — many
predate this remote (OSS republish) or were merged via a different tracker. Spot
check: ~40 remote branches have commits older than 2026-07-24 (3+ weeks) and no
merge record here, e.g. `origin/feat/pi-harness`, `origin/feat/squad-flow-viz`,
`origin/feat/trust-zcc-tools`, `origin/release/1.0.4`, `origin/release/1.0.6`,
`origin/chore/electron-vite-5`, `origin/worktree-rust-tauri-migration`. Recommend a
manual review pass (owner sign-off) rather than automated deletion, since PR status
here can't confirm they've landed.

## 2. Stray worktree (repeat flag)

`.claude/worktrees/main-check` — detached HEAD at a commit from **2026-07-26**
(18 days old), 25 MB, first flagged on 07-31 and still unresolved. Not part of the
repo, not pinning a branch anyone is actively using. Recommend:
```
git worktree remove .claude/worktrees/main-check
```

## 3. Oversized working-tree files

Largest tracked files (non-binary source of interest):

| File | Size / lines | Trend since 07-31 |
|---|---|---|
| `src/renderer/styles/global.css` | 640K / 28,072 lines | ↓ from 30,492 — improved |
| `src/main/index.ts` | 412K / 9,297 lines | ↑ from 8,151 (+14%) — keep growing concern |
| `src/shared/types.ts` | 268K / 5,996 lines | not previously tracked |
| `src/renderer/store.ts` | 220K / 5,461 lines | not previously tracked |
| `src/main/pty.ts` | 160K / 3,128 lines | not previously tracked |

Binary assets are all reasonably sized (largest is the 1.4 MB demo GIF, duplicated
once in `website/public/` and once in `docs/assets/` — same file two places, fine if
intentional for the two publish targets). `package-lock.json` at 588K is normal for
this dependency count.

`index.ts` growing 14% in under two weeks is the one number worth acting on — still
recommend a splitting pass (module registration, IPC handlers, and lifecycle glue
look like the natural seams) before it crosses 10K lines.

## 4. Broken docs/README links

None found. The naive link-checker flagged 16 hits; all are false positives:
- `` `module[hook](ctx)` `` code-inline snippets in `CLAUDE.md` and prior repo-health
  reports (not a markdown link).
- JS object literals inside fenced code blocks in
  `docs/plans/2026-07-12-afl-borrowed-features.md` (regex misparsed `[...](...)`-shaped
  JS as a link).
- `/docs/...`, `/download/` root-relative links in `website/content/docs/*.md` — these
  are Next.js site routes (clean URLs, no `.md`), correct as written for the docs site.

One link worth a manual look even though it's not a hard 404 in the checker's file-tree
sense: `docs/extension-personas-teams-plan.md:9` links to
`[`cu-parity-master-plan.md`](./cu-parity-master-plan.md)`, which does not exist
anywhere in the repo (no similarly-named file either) — looks like a genuinely dead
reference to a plan doc that was never added or was renamed/removed. Confirm intent
and either restore the file or drop the link.

## Uncommitted working-tree state (unrelated to this sweep, noted for awareness)

`git status` shows two modified-but-uncommitted files:
`src/main/__tests__/agent-status.test.ts`, `src/main/agent-status.ts`. Not touched by
this triage — flagging so it isn't mistaken for drift this report caused.
