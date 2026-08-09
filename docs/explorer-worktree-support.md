# Explorer Git-Worktree Support

Status: **implemented** · Date: 2026-06-16

Lets a user navigate the Explorer between the linked git worktrees of a repo —
flipping the file tree, the changes list, and the diff panel together — and
edit/create/rename/delete files in the selected checkout safely.

## Why

Agents can create worktrees (`isolation: "worktree"`), and developers routinely
keep parallel checkouts. Before this change the Explorer was hard-bound to a
single root (`project.path`): there was no way to view another worktree, git
status/diff happened to work against worktrees only by accident, and CRUD in a
worktree was rejected because a worktree path isn't a registered project.

See the impact analysis that motivated this: a worktree lives **outside**
`project.path`, has `.git` as a **file** (gitdir pointer), and shares the repo's
*common* git dir with the main checkout.

## What shipped

### Agent launch isolation
- **Settings > Agents > Git worktrees** controls the default for new agents.
- **New Agent > Customize launch > Worktree** overrides that default per launch.
  Worktree Name follows opening prompt until directly edited, normalizes to one
  lowercase underscore-separated segment (40 characters max), and controls both
  branch and checkout identity.
- The control appears for local, non-scratch Git projects after a main-backed
  eligibility probe. Main revalidates at launch; named invalid requests fail visibly.
- Managed checkouts live below `~/zcc-worktrees/<project-tag>/<name>` on branches
  named `zcc/<name>`. Reusing a managed name deliberately continues there;
  distinct names produce distinct checkouts even when prompts match.
- Missing names block submission with accessible inline validation. Named git
  creation/reuse errors fail closed and stay visible in launcher instead of
  silently starting in shared project root. Main repeats normalization,
  confinement, and serialized allocation per repository/name. Legacy boolean API
  callers retain generated fallback behavior.
- Repositories declaring `.gitmodules` are rejected with a visible launch error.
  Git documents incomplete multiple-worktree support for submodules; managed
  isolation stays fail-closed until that limitation is removed or safely handled.

### Backend (`src/main/git.ts`)
- `listWorktrees(cwd)` — runs `git worktree list --porcelain -z`, returns
  `Worktree[]` (path, head, branch, detached, bare, isMain). First entry is the
  main checkout. `.git`-as-a-file is handled transparently by git.
- `gitCommonDir(cwd)` — `git rev-parse --git-common-dir` (realpath'd). Two paths
  belong to the same repo iff their common-dirs match; this is the trust anchor.

### Trust gate (`src/main/index.ts` `trustedProjectRoot`)
Now async. A root is trusted if it realpath-matches a registered project **OR**
its git common-dir matches a registered project's common-dir (i.e. it's a
worktree of a registered project). This extends CLAUDE.md rule #2's anchor set
and unlocks FS create/rename/delete in a worktree. A non-repo path has a `null`
common-dir and never matches, so trust is not widened to arbitrary paths.

### IPC / types / preload
- `git:listWorktrees` channel (`ipc.ts`), preload binding, `cc.git.listWorktrees`.
- `Worktree` interface in `src/shared/types.ts`.

### Renderer (`src/renderer/components/ExplorerView.tsx`)
- New `viewRoot` state (defaults to `project.path`). Every tree/git operation
  keys off `viewRoot` instead of `project.path` (root seed, reveal, changes list,
  dirty-dir rollup, create/rename/delete confinement root, path trimming).
- Worktree switcher dropdown in the tree header, shown only when the repo has
  >1 worktree. Picking a worktree re-roots the tree, closes the open file, and
  loads that checkout's git status.
- Git status: the main checkout reuses the store's status (kept fresh by
  existing hooks); other worktrees use a local `git.status(viewRoot)` fetch,
  refreshed via a single `reloadGitStatus()` seam that all mutations call.

## Why git diff/status needed zero new logic

`findToplevel` already does `existsSync('${dir}/.git')`, which is true for a
`.git` **file** too — so `git status`/`git show HEAD:` run with `cwd`=worktree
resolve the worktree's own gitdir and report the correct per-worktree branch and
diffs. Passing `viewRoot` instead of `project.path` is all that was required.

## Tests

`src/main/__tests__/git-worktree.test.ts` — real temp repo + worktree:
enumeration, isMain flagging, branch/detached parsing, common-dir match across a
repo+worktree, common-dir mismatch across unrelated repos, non-repo/empty-path
defenses. Current verification evidence lives in plan/review docs.

## Deliberately out of scope

- **Broad read-path confinement.** `fs.listDir/readFile/walkFiles/searchFiles`
  (and `writeFile`) remain unconfined app-wide — that's a pre-existing
  rule-1/2 gap, shared by Library/Inbox/Search/the VS Code FS provider, not
  specific to worktrees. Closing it is an app-wide refactor that deserves its
  own change; bundling it here would risk regressing those unrelated consumers.
  The worktree feature does **not** rely on a new read hole — it reads worktree
  paths through the same already-unconfined handlers everything else uses.
- **Project identity / dedup by repo.** Worktrees are not registered as their
  own projects; they're an alternate view of the parent. Registering them as
  linked projects (with a repo-identity key) is a possible future step.
