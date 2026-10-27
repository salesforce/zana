# Issue 389: composer branch refresh research

Research date: 2026-10-27. Planning only; no product changes or runtime reproduction performed.

## Finding

[Issue #389](https://github.com/salesforce/zana/issues/389) reports that the composer continues to show branch A after a terminal or agent switches the checkout to branch B. The source demonstrates a data-source mismatch, rather than an absence of polling:

1. [`conversationThreadView`](../../apps/server/src/services/threads/conversation-thread-view.ts) returns `branchName` from the stored environment record. It does not read Git on each thread request.
2. [`ThreadDetailView.applyThreadRecord`](../../apps/app/src/views/threads/ThreadDetailView.tsx) assigns that metadata to `branchName` and passes it to `PromptContextBanner`.
3. [`PromptContextBanner`](../../apps/app/src/components/thread/timeline/ComposerStackCards.tsx) already requests workspace status and pull-request metadata every 3 seconds with `loadWorkspaceMeta`, but only consumes the returned pull request. Its `git:` text still uses the persisted `branchName` prop.
4. [`loadWorkspaceMeta`](../../apps/app/src/components/thread/secondary-panel/threadSecondaryPanelLogic.ts) returns both results and converts independent failures to null. Status is available but discarded by this consumer.

Thus reopening or repeatedly fetching the thread is not a reliable repair: it can keep supplying the same stored branch. This is a source-level diagnosis; a built-app regression should establish the observed failure before implementation.

## Recommended approach

Use `WorkspaceStatus.branchName` from the existing environment-status path for the composer branch. Retain the stored prop as an initial fallback and for threads without a usable environment. Keep live status scoped to the current environment/thread identity; do not write observed branch changes into environment provisioning metadata merely to update this label.

The existing [`product.environments.status`](../../apps/app/src/lib/product-client.ts) front door shares a [`status client`](../../apps/app/src/lib/environment-status-client.ts) that deduplicates in-flight calls per environment, reuses results for 1 second, reuses cached status while hidden, backs off after errors, and caps its cache at 64 entries. The server [`environmentStatus`](../../apps/server/src/services/environments/environment-actions.ts) resolves the registered environment's host/path rather than accepting a renderer-supplied path; its [`workspace status cache`](../../apps/server/src/services/environments/workspace-status-cache.ts) shares host RPCs per host/path/provisioning type for 1.5 seconds, capped at 256 entries. Reuse these boundaries for both local and remote environments and linked worktrees.

Keep the existing 3-second cadence. Cache alignment and host latency can extend the observed delay beyond one tick; use a bounded eventual assertion in E2E rather than promise exactly 3 seconds. Avoid lowering global cache TTLs without evidence.

### State and lifecycle semantics

- Before any successful live status, the recorded branch may be shown as the current fallback.
- A successful status with `branchName: null` is authoritative: remove the old `git:` branch segment. Do not implement `status?.branchName ?? recordedBranch`, which resurrects stale metadata in detached/non-repository cases. The [domain status schema](../../packages/domain/src/environment.ts) deliberately permits null; [checkout kinds](../../packages/domain/src/git-checkout.ts) distinguish branch, detached, unborn, and unknown.
- A transient failed status request is not evidence of a detached checkout. Preserve the last successfully read branch for that environment; a later successful poll must recover automatically.
- Reset or derive identity-scoped state on environment/thread changes, including removal of the environment. An old environment's branch must not appear in a new thread, even for the render before the next effect runs.
- Ignore late results after identity changes or unmount. Clear polling timers. Prevent overlapping refresh applications from replacing newer status with older status; use single-flight per effect or request generations where needed.
- Preserve worktree/fork/child labels, PR link behavior, and existing hidden-window cache/backoff behavior.
- `loadWorkspaceMeta` waits for both status and PR via `Promise.all`. If implementation relies on its combined result, a slow PR delays the branch too. Prefer updating branch independently when status settles, while retaining bounded PR polling. Do not introduce overlapping unbounded PR requests while doing so.

## Alternatives considered

| Option | Assessment |
| --- | --- |
| Consume existing environment-status polling | Recommended: smallest relevant change, correct host/checkout identity, reuses authorization and bounded caching. |
| Use `useSessionGit` / `useGitInfo` | Poor fit: [`gitInfo.ts`](../../apps/app/src/lib/gitInfo.ts) explicitly skips remote projects and has a 30-second TTL. Adding this to the composer duplicates an existing live status path. |
| Watch `.git/HEAD` and broadcast events | Larger change than necessary. Requires authorization, remote-host watchers, reconnection, sharing, cleanup, and platform handling. Linked worktrees have their own HEAD, resolved through `git rev-parse --git-path HEAD`, not a universal checkout `.git/HEAD` path. [Git worktree documentation](https://git-scm.com/docs/git-worktree). |
| Detect branch changes from terminal output or agent completion | Incomplete: misses switches made in another terminal/tool and creates coupling to command text or provider events. |
| Refresh stored branch metadata on every thread fetch | Adds Git work to thread reads and conflates provisioning identity with observed checkout state; unnecessary for this UI bug. |

Filesystem watching is also platform-dependent: Node documents inconsistent `fs.watch` behavior and unreliable support on network/virtualized filesystems. This reinforces retaining the current host-status abstraction for this fix. [Node filesystem documentation](https://nodejs.org/api/fs.html#caveats).

## Verification recommendations

Add behavior tests for `PromptContextBanner` with controlled promises/fake timers: launch A to live B while metadata stays A; subsequent B to C; authoritative null; transient error and recovery; absent environment; switching environments with an outstanding old request; unmount cleanup; and PR failure/latency independent of branch. Test worktree/fork/child text and PR links remain intact. Existing nearby tests include [`composer-stack.test.ts`](../../apps/app/src/components/thread/timeline/composer-stack.test.ts), which is largely source-text coverage and does not prove this runtime behavior, and [`environment-status-client.test.ts`](../../apps/app/src/lib/environment-status-client.test.ts), which covers shared request behavior.

Add or extend a built-Electron E2E using a private fixture repo and the fake provider: open a thread on A, externally execute real `git switch B` in its actual checkout, assert `thread-prompt-context` eventually shows B without navigation/restart, then detach and verify A/B is removed. Add a linked-worktree case to ensure it follows the thread checkout rather than project root. [`thread-composer-seam.spec.ts`](../../e2e/thread-composer-seam.spec.ts) provides a portable Git fixture and worktree-thread setup; [`workspace-status-large-repo.spec.ts`](../../e2e/workspace-status-large-repo.spec.ts) demonstrates real renderer/server/host status polling and request-count assertions, but its shell wrapper is Unix-specific.

Require at least 80% coverage for modified code, focused renderer tests, the new built-Electron regression through `pnpm test:e2e -- <spec>`, and `pnpm verify:fast`, per root [AGENTS.md](../../AGENTS.md). No launch, mode/reasoning, browser, or plugin runtime seams need modification for the recommended fix, so their additional live-suite triggers should not apply unless implementation scope expands.
