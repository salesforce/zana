import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk/server";
import type { ProviderRetryView } from "./contract.js";
import {
  inspectProviderRetry,
  type ProviderRetryCandidate as RecoveryCandidate,
  type ProviderRetryInspection as RecoveryStatus,
} from "./recovery.js";

export const RESET_BUFFER_MS = 15_000;
const RESET_JITTER_MS = 30_000;
export const RELEASE_PACE_MS = 1_000;
export const DEFAULT_MAXIMUM_WAIT_MS = 6 * 60 * 60 * 1_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;
const REALTIME_CHANNEL = "provider-retry";

interface ProviderRetrySources {
  now(): number;
  random(): number;
}

interface WaitingEntry {
  candidate: RecoveryCandidate;
  firstObservedAtMs: number;
  hostId: string;
  providerId: string;
  releasing: boolean;
  retryAtMs: number | null;
  scopeKey: string;
  threadId: string;
}

interface ScopeQueue {
  releasing: boolean;
  threadIds: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAutomaticCandidate(
  candidate: RecoveryCandidate | null,
): candidate is RecoveryCandidate & { automatic: true; resetsAtMs: number } {
  return candidate?.automatic === true && candidate.resetsAtMs !== null;
}

function toView(entry: WaitingEntry): ProviderRetryView | null {
  if (entry.releasing) return null;
  return {
    threadId: entry.threadId,
    providerId: entry.providerId,
    retryAtMs: entry.retryAtMs,
  };
}

export class ProviderRetryService {
  private readonly entries = new Map<string, WaitingEntry>();
  private readonly scopes = new Map<string, ScopeQueue>();
  private readonly threadLocks = new Map<string, Promise<void>>();
  private disposed = false;

  constructor(
    private readonly zcc: ZccPluginApi,
    private readonly sources: ProviderRetrySources = {
      now: () => Date.now(),
      random: () => Math.random(),
    },
    private maximumWaitMs: number | null = DEFAULT_MAXIMUM_WAIT_MS,
  ) {
    this.validateMaximumWait(maximumWaitMs);
  }

  setMaximumWaitMs(maximumWaitMs: number | null): void {
    this.validateMaximumWait(maximumWaitMs);
    if (this.maximumWaitMs === maximumWaitMs) return;
    this.maximumWaitMs = maximumWaitMs;
    for (const entry of [...this.entries.values()]) {
      const resetsAtMs = entry.candidate.resetsAtMs;
      if (
        !entry.releasing &&
        (resetsAtMs === null ||
          !this.withinMaximumWait(resetsAtMs, entry.firstObservedAtMs))
      ) {
        this.remove(entry.threadId);
      }
    }
  }

  private validateMaximumWait(maximumWaitMs: number | null): void {
    if (
      maximumWaitMs !== null &&
      (!Number.isFinite(maximumWaitMs) || maximumWaitMs < 0)
    ) {
      throw new Error("Maximum provider retry wait must be nonnegative");
    }
  }

  private withinMaximumWait(
    resetsAtMs: number,
    firstObservedAtMs: number,
  ): boolean {
    return (
      this.maximumWaitMs === null ||
      resetsAtMs - firstObservedAtMs <= this.maximumWaitMs
    );
  }

  private retryAt(resetsAtMs: number): number {
    return (
      resetsAtMs +
      RESET_BUFFER_MS +
      Math.floor(this.sources.random() * RESET_JITTER_MS)
    );
  }

  list(): ProviderRetryView[] {
    return [...this.entries.values()]
      .flatMap((entry) => {
        const view = toView(entry);
        return view === null ? [] : [view];
      })
      .sort((a, b) => a.threadId.localeCompare(b.threadId));
  }

  status(threadId: string): ProviderRetryView | null {
    const entry = this.entries.get(threadId);
    return entry === undefined ? null : toView(entry);
  }

  async cancel(threadId: string): Promise<boolean> {
    return this.withThreadLock(threadId, () => {
      const entry = this.entries.get(threadId);
      if (entry === undefined || entry.releasing) return false;
      this.remove(threadId);
      return true;
    });
  }

  async retry(threadId: string): Promise<{ started: boolean }> {
    return this.withThreadLock(threadId, async () => {
      const status = await inspectProviderRetry(this.zcc, threadId);
      if (status.candidate === null) {
        this.remove(threadId);
        return { started: false };
      }
      await this.continueCandidate(threadId, status.candidate);
      this.remove(threadId);
      return { started: true };
    });
  }

  async reconcile(threadId: string): Promise<void> {
    return this.withThreadLock(threadId, () => this.reconcileDirect(threadId));
  }

  supersede(threadId: string): void {
    this.remove(threadId);
  }

  deleteThread(threadId: string): void {
    this.remove(threadId);
  }

  private async withThreadLock<T>(
    threadId: string,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const previous = this.threadLocks.get(threadId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    const lock = next.then(
      () => undefined,
      () => undefined,
    );
    this.threadLocks.set(threadId, lock);
    try {
      return await next;
    } finally {
      if (this.threadLocks.get(threadId) === lock) {
        this.threadLocks.delete(threadId);
      }
    }
  }

  private async reconcileDirect(threadId: string): Promise<void> {
    if (this.disposed) return;
    const existing = this.entries.get(threadId);
    if (existing?.releasing) return;
    const status = await inspectProviderRetry(this.zcc, threadId);
    if (this.disposed) return;
    if (!isAutomaticCandidate(status.candidate) || status.hostId === null) {
      this.remove(threadId);
      return;
    }
    const candidate = status.candidate;
    if (!this.withinMaximumWait(candidate.resetsAtMs, this.sources.now())) {
      this.remove(threadId);
      return;
    }
    const retryAtMs = this.retryAt(candidate.resetsAtMs);
    const entry: WaitingEntry = {
      candidate,
      firstObservedAtMs: existing?.firstObservedAtMs ?? this.sources.now(),
      hostId: status.hostId,
      providerId: this.providerIdFromScope(status.scopeKey),
      releasing: false,
      retryAtMs,
      scopeKey: status.scopeKey,
      threadId,
    };
    this.entries.set(threadId, entry);
    this.ensureScope(status.scopeKey).threadIds.add(threadId);
    this.publish(threadId);
    this.schedule(status.scopeKey);
  }

  private providerIdFromScope(scopeKey: string): string {
    const sep = scopeKey.indexOf(":");
    return sep === -1 ? scopeKey : scopeKey.slice(sep + 1);
  }

  private ensureScope(scopeKey: string): ScopeQueue {
    const existing = this.scopes.get(scopeKey);
    if (existing) return existing;
    const created: ScopeQueue = {
      releasing: false,
      threadIds: new Set(),
      timer: null,
    };
    this.scopes.set(scopeKey, created);
    return created;
  }

  private remove(threadId: string): void {
    const entry = this.entries.get(threadId);
    if (!entry) return;
    this.entries.delete(threadId);
    const scope = this.scopes.get(entry.scopeKey);
    if (scope) {
      scope.threadIds.delete(threadId);
      if (scope.threadIds.size === 0) {
        if (scope.timer !== null) clearTimeout(scope.timer);
        this.scopes.delete(entry.scopeKey);
      } else {
        this.schedule(entry.scopeKey);
      }
    }
    this.publish(threadId);
  }

  private publish(threadId: string): void {
    this.zcc.realtime.publish(REALTIME_CHANNEL, { threadId });
  }

  private schedule(scopeKey: string): void {
    const scope = this.scopes.get(scopeKey);
    if (!scope || this.disposed) return;
    if (scope.timer !== null) {
      clearTimeout(scope.timer);
      scope.timer = null;
    }
    if (scope.releasing) return;
    const retryAtMs = [...scope.threadIds]
      .map((threadId) => this.entries.get(threadId))
      .flatMap((entry) =>
        entry && !entry.releasing && entry.retryAtMs !== null
          ? [entry.retryAtMs]
          : [],
      )
      .sort((a, b) => a - b)[0];
    if (retryAtMs === undefined) return;
    const delay = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, retryAtMs - this.sources.now()),
    );
    scope.timer = setTimeout(() => {
      scope.timer = null;
      void this.runScope(scopeKey);
    }, delay);
  }

  private async runScope(scopeKey: string): Promise<void> {
    const scope = this.scopes.get(scopeKey);
    if (!scope || scope.releasing || this.disposed) return;
    const dueEntry = [...scope.threadIds]
      .map((threadId) => this.entries.get(threadId))
      .filter(
        (entry): entry is WaitingEntry =>
          entry !== undefined &&
          !entry.releasing &&
          entry.retryAtMs !== null &&
          entry.retryAtMs <= this.sources.now(),
      )
      .sort(
        (a, b) =>
          (a.retryAtMs ?? 0) - (b.retryAtMs ?? 0) ||
          a.threadId.localeCompare(b.threadId),
      )[0];
    if (!dueEntry) {
      this.schedule(scopeKey);
      return;
    }

    scope.releasing = true;
    try {
      await this.release(dueEntry.threadId);
    } finally {
      scope.releasing = false;
      this.schedule(scopeKey);
    }
  }

  private async release(threadId: string): Promise<boolean> {
    return this.withThreadLock(threadId, () => this.releaseDirect(threadId));
  }

  private async releaseDirect(threadId: string): Promise<boolean> {
    const entry = this.entries.get(threadId);
    if (!entry || this.disposed) return false;
    const failedRequestId = entry.candidate.failedRequestId;
    entry.releasing = true;
    this.publish(threadId);
    try {
      const status = await inspectProviderRetry(this.zcc, threadId);
      if (this.disposed) return false;
      if (
        status.candidate === null ||
        !isAutomaticCandidate(status.candidate) ||
        status.candidate.failedRequestId !== failedRequestId
      ) {
        this.remove(threadId);
        return false;
      }
      await this.continueCandidate(threadId, status.candidate);
      this.remove(threadId);
      return true;
    } catch (error) {
      this.zcc.log.warn(
        `Provider retry for thread ${threadId} could not start: ${errorMessage(error)}`,
      );
      this.remove(threadId);
      return false;
    }
  }

  private async continueCandidate(
    threadId: string,
    _candidate: RecoveryCandidate,
  ): Promise<void> {
    await this.zcc.sdk.threads.send({
      threadId,
      prompt: "Please continue.",
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const scope of this.scopes.values()) {
      if (scope.timer !== null) clearTimeout(scope.timer);
    }
    this.scopes.clear();
    this.entries.clear();
    this.threadLocks.clear();
  }
}
