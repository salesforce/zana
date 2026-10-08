import type { WorkspaceStatus } from '@zana-ai/zcc-domain';

/**
 * Shared front door for `GET /environments/:id/status`.
 *
 * The composer banner, workspace banner, environment actions, info panel and
 * diff panel each poll the same environment every few seconds. Without
 * sharing, one open thread sent several overlapping status requests per tick,
 * and on a large checkout each one queued another `git status` on the host.
 * Every caller goes through here, so:
 *
 * - concurrent calls for an environment join the request in flight;
 * - a result is reused for `reuseMs`, so pollers on offset timers share it;
 * - while the window is hidden, the last result is served without a request;
 * - after a failure, calls fail fast with the same error and back off
 *   exponentially (up to `maxBackoffMs`) instead of hammering a slow host.
 */
export const ENVIRONMENT_STATUS_REUSE_MS = 1_000;
const MIN_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_ENTRIES = 64;

interface Entry {
  inflight: Promise<WorkspaceStatus> | null;
  value: WorkspaceStatus | null;
  settledAt: number;
  error: unknown;
  failures: number;
  retryAt: number;
}

export interface EnvironmentStatusClientOptions {
  fetchStatus: (environmentId: string) => Promise<WorkspaceStatus>;
  now?: () => number;
  isHidden?: () => boolean;
  reuseMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface EnvironmentStatusClient {
  status(environmentId: string): Promise<WorkspaceStatus>;
  /** Drop the cached result, e.g. after a commit, so the next call refetches. */
  invalidate(environmentId: string): void;
}

const documentHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function createEnvironmentStatusClient(options: EnvironmentStatusClientOptions): EnvironmentStatusClient {
  const now = options.now ?? Date.now;
  const isHidden = options.isHidden ?? documentHidden;
  const reuseMs = options.reuseMs ?? ENVIRONMENT_STATUS_REUSE_MS;
  const minBackoffMs = options.minBackoffMs ?? MIN_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? MAX_BACKOFF_MS;
  const entries = new Map<string, Entry>();

  function entryFor(environmentId: string): Entry {
    let entry = entries.get(environmentId);
    if (entry) {
      entries.delete(environmentId);
    } else {
      entry = { inflight: null, value: null, settledAt: 0, error: null, failures: 0, retryAt: 0 };
    }
    entries.set(environmentId, entry);
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
    return entry;
  }

  return {
    status(environmentId) {
      const entry = entryFor(environmentId);
      if (entry.inflight) return entry.inflight;
      const at = now();
      if (entry.failures > 0 && at < entry.retryAt) return Promise.reject(entry.error);
      if (entry.value && (at - entry.settledAt < reuseMs || isHidden())) return Promise.resolve(entry.value);
      const request = options.fetchStatus(environmentId).then(
        (value) => {
          if (entry.inflight === request) {
            entry.value = value;
            entry.settledAt = now();
            entry.failures = 0;
            entry.error = null;
          }
          return value;
        },
        (error: unknown) => {
          if (entry.inflight === request) {
            entry.failures += 1;
            entry.error = error;
            entry.retryAt = now() + Math.min(maxBackoffMs, minBackoffMs * 2 ** (entry.failures - 1));
          }
          throw error;
        }
      ).finally(() => {
        if (entry.inflight === request) entry.inflight = null;
      });
      entry.inflight = request;
      return request;
    },
    invalidate(environmentId) {
      entries.delete(environmentId);
    }
  };
}
