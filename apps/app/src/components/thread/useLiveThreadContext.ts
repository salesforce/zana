import { useEffect, useState } from 'react';
import type { GitHostPullRequest } from '@zana-ai/zcc-domain';
import { product } from '../../lib/product-client.js';

const THREAD_CONTEXT_POLL_MS = 3_000;

export function useLiveThreadContext({
  threadId,
  environmentId,
  branchName
}: {
  threadId?: string;
  environmentId?: string | null;
  branchName?: string | null;
}) {
  const [context, setContext] = useState<{
    threadId: string | undefined;
    environmentId: string;
    // Undefined means no successful live read; null is an authoritative detached/non-repo result.
    branch: string | null | undefined;
    pullRequest: GitHostPullRequest | null;
  } | null>(null);

  useEffect(() => {
    if (!environmentId) {
      setContext(null);
      return;
    }
    setContext({ threadId, environmentId, branch: undefined, pullRequest: null });
    let cancelled = false;
    let statusPending = false;
    let prPending = false;
    const refresh = () => {
      // Independent single-flight reads keep a slow PR from blocking branch updates
      // or accumulating requests. Shared status caching still coalesces other surfaces.
      if (!statusPending) {
        statusPending = true;
        void product.environments.status(environmentId).then((status) => {
          if (!cancelled) setContext((current) => current && { ...current, branch: status.branchName });
        }).catch((err: unknown) => {
          // A transport failure is not a detached checkout: retain the last live branch.
          console.error('Failed to fetch environment status:', err);
        }).finally(() => { statusPending = false; });
      }
      if (!prPending) {
        prPending = true;
        void product.environments.pullRequest(environmentId).then(({ pullRequest }) => {
          if (!cancelled) setContext((current) => current && { ...current, pullRequest });
        }).catch((err: unknown) => {
          console.error('Failed to fetch pull request metadata:', err);
          if (!cancelled) setContext((current) => current && { ...current, pullRequest: null });
        }).finally(() => { prPending = false; });
      }
    };
    refresh();
    const timer = window.setInterval(refresh, THREAD_CONTEXT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [threadId, environmentId]);

  const live = context?.threadId === threadId && context?.environmentId === environmentId ? context : null;
  const displayedBranch = live?.branch !== undefined ? live.branch : branchName;
  const pullRequest = live?.pullRequest ?? null;

  return { displayedBranch, pullRequest };
}
