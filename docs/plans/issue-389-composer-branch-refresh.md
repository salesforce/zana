# Plan: Live Composer Branch Refresh (Issue #389)

Track the live Git checkout in the thread composer after external branch changes, without breaking detached-HEAD handling, slow pull-request lookups, or thread-context caching.

## Background and Root Cause

The thread composer renders branch context via `PromptContextBanner` in [`ComposerStackCards.tsx`](../../apps/app/src/components/thread/timeline/ComposerStackCards.tsx). The component receives an initial `branchName` prop originating from persisted thread metadata (`thread.branchName`).

`PromptContextBanner` already polled `loadWorkspaceMeta` on a 3-second timer (`PROMPT_CONTEXT_POLL_MS`), but it only updated the pull-request state:

```ts
const refresh = () => {
  void loadWorkspaceMeta(
    product.environments.status,
    product.environments.pullRequest,
    environmentId
  ).then(({ pullRequest: nextPr }) => {
    if (cancelled) return;
    setPullRequest((nextPr as GitHostPullRequest | null) ?? null);
  });
};
```

When a user switched branches in an external terminal, the environment status cache on the server/host updated (`WorkspaceStatusCache`), but the composer never subscribed to or re-rendered the live branch name.

## Requirements

1. **Live Branch Updates:** The composer prompt context banner must reflect the active branch reported by `product.environments.status(environmentId)`.
2. **Detached HEAD & Non-Repository:** When `status.branchName` is `null`, the banner must authoritatively clear the branch label (or hide the banner if no other bits remain).
3. **Transient Failure Resilience:** If an environment status poll fails due to transport or temporary errors, the last successfully read live branch should be retained rather than erroneously clearing or falling back to stale initial props.
4. **Decoupled Polling:** Status and pull request polling must execute independently so that slow pull request fetches do not delay branch updates or accumulate pending requests.
5. **Lifecycle Safety:** Cancelling polling on thread navigation, environment unmount, or component unmount must prevent state updates across unmounted boundaries.

## Architecture and Seams

- **Component:** `apps/app/src/components/thread/timeline/ComposerStackCards.tsx`
  - Encapsulate live branch and pull-request polling within `useLivePromptContext`.
  - Retain `PromptContextBanner` as a focused presentation component that formats contextual bits (branch, worktree, fork, child threads/agents, and PR links).
- **Backend/IPC Seams:** Unchanged. Reuses `product.environments.status` and `product.environments.pullRequest`.

## Verification Strategy

- **Unit / Component Tests:** [`ComposerStackCards.context.test.tsx`](../../apps/app/src/components/thread/timeline/ComposerStackCards.context.test.tsx)
  - Live branch replacement of initial metadata.
  - Periodic polling updates after external branch switch.
  - Detached HEAD (`branchName: null`) clearing.
  - Offline / error resilience and recovery.
  - Independent PR polling and slow-response bounds.
  - Thread and environment ID identity scoping.
- **E2E Tests:** [`e2e/thread-composer-branch-refresh.spec.ts`](../../e2e/thread-composer-branch-refresh.spec.ts)
  - Built Electron boundary tests for external Git checkout switches and detached HEAD in project roots and thread worktrees.

## Implementation Results

`useLivePromptContext` consumes the live environment-status response on its existing 3-second interval. Branch and PR reads run independently with single-flight guards per poll type. Successful null branch results clear the stale label; failed status requests retain the last success. Results are scoped to both thread and environment, with cleanup and cancellation protecting navigation and unmounts. Stored environment metadata and backend APIs remain unchanged.

Coverage meets the 80% threshold across statements, lines, and branches. Built-Electron and focused component regression suites verify both project and managed worktree checkouts.
