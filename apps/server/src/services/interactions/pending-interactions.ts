import {
  createPendingInteraction,
  getActivePendingInteractionForThread,
  getConversationThread,
  getEnvironment,
  getPendingInteraction,
  getPendingInteractionByProviderRequest,
  hasPendingInteractionForThread,
  interruptPendingInteractionsForPlugin,
  interruptPendingInteractionsForThreadIds,
  interruptPendingInteractionsForThreads,
  listActivePendingInteractionThreadIdsForHost,
  listActivePluginPendingInteractions,
  listPendingInteractionsByThread,
  setPendingInteractionInterrupted,
  setPendingInteractionResolved,
  setPendingInteractionResolving,
  type PendingInteractionRow,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import {
  isApprovalPendingInteractionPayload,
  isPluginPendingInteraction,
  PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES,
  pendingInteractionCreateSchema,
  type JsonValue,
  type PendingInteraction,
  type PendingInteractionCreate,
  type PendingInteractionResolution
} from '@zana-ai/zcc-domain/thread-runtime';
import type { HostDaemonInteractiveRequestResponse } from '@zana-ai/zcc-host-daemon-contract';
import { HostUnavailableError } from '../../http/host-hub.js';
import type { ProductHub } from '../../http/product-hub.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { toPendingInteraction } from './pending-interaction-serialization.js';
import { appendPendingInteractionTimelineEvent } from './pending-interaction-timeline.js';
import {
  pendingInteractionResolutionEquals,
  validatePendingInteractionResolution
} from './pending-interaction-validation.js';

export type PluginInteractionCancelReason =
  | 'user'
  | 'request-aborted'
  | 'thread-stopped'
  | 'thread-deleted'
  | 'plugin-disposed'
  | 'server-restarted'
  | 'timeout';

export type PluginInteractionResult =
  | { outcome: 'submitted'; value: JsonValue }
  | { outcome: 'cancelled'; reason: PluginInteractionCancelReason };

interface PluginInteractionWaiter {
  resolve: (result: PluginInteractionResult) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener: () => void;
}

export interface PendingInteractionLifecycleDeps {
  db: ZccDatabase;
  hub: ProductHub;
  callHostOnlineRpc: (input: {
    hostId: string;
    command: {
      type: 'interactive.resolve';
      threadId: string;
      interactionId: string;
      providerId: string;
      providerThreadId: string;
      providerRequestId: string;
      resolution: PendingInteractionResolution;
    };
  }) => Promise<unknown>;
  onInteractionSettled?: (args: {
    threadId: string;
    status: PendingInteraction['status'];
    statusReason: string | null;
  }) => void;
}

function conflict(interaction: PendingInteraction): ThreadCreateError {
  return new ThreadCreateError(
    409,
    'invalid_request',
    `Pending interaction ${interaction.id} is already ${interaction.status}`
  );
}

function threadView(db: ZccDatabase, threadId: string) {
  const thread = getConversationThread(db, threadId);
  if (!thread) return null;
  const environment = thread.environmentId ? getEnvironment(db, thread.environmentId) : null;
  return {
    ...thread,
    cwd: environment?.path ?? null,
    branchName: environment?.branchName ?? null,
    isWorktree: environment?.isWorktree ?? false,
    hasPendingInteraction: hasPendingInteractionForThread(db, threadId)
  };
}

function notifyThread(deps: PendingInteractionLifecycleDeps, threadId: string): void {
  const view = threadView(deps.db, threadId);
  if (view) deps.hub.emit('threads:updated', view);
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export class PendingInteractionLifecycle {
  private readonly deps: PendingInteractionLifecycleDeps;
  private readonly pluginWaiters = new Map<string, PluginInteractionWaiter>();
  private started = false;

  constructor(deps: PendingInteractionLifecycleDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.settleInterruptedRows(
      listActivePluginPendingInteractions(this.deps.db).flatMap((row) => {
        const updated = setPendingInteractionInterrupted(this.deps.db, {
          id: row.id,
          statusReason: 'server-restarted'
        });
        return updated ? [updated] : [];
      })
    );
  }

  listPendingThreadInteractions(threadId: string): PendingInteraction[] {
    return listPendingInteractionsByThread(this.deps.db, {
      threadId,
      statuses: ['pending', 'resolving']
    }).map(toPendingInteraction);
  }

  getThreadInteraction(args: { threadId: string; interactionId: string }): PendingInteraction {
    const interaction = this.requireInteraction(args.interactionId);
    if (interaction.threadId !== args.threadId) {
      throw new ThreadCreateError(404, 'invalid_request', 'Pending interaction not found');
    }
    return interaction;
  }

  hasPendingThreadInteraction(threadId: string): boolean {
    return getActivePendingInteractionForThread(this.deps.db, threadId) !== null;
  }

  registerPendingInteraction(
    interaction: PendingInteractionCreate
  ): HostDaemonInteractiveRequestResponse {
    const parsed = pendingInteractionCreateSchema.safeParse(interaction);
    if (!parsed.success) {
      return { outcome: 'rejected', reason: 'Invalid interactive request' };
    }
    const request = parsed.data;
    const thread = getConversationThread(this.deps.db, request.threadId);
    if (!thread) {
      return { outcome: 'rejected', reason: 'Thread does not exist' };
    }
    if (thread.providerId !== request.providerId) {
      return {
        outcome: 'rejected',
        reason: `Thread ${request.threadId} belongs to provider ${thread.providerId}, not ${request.providerId}`
      };
    }
    if (
      isApprovalPendingInteractionPayload(request.payload)
      && request.payload.availableDecisions.length === 0
    ) {
      return { outcome: 'rejected', reason: 'Approvals must include at least one available decision' };
    }

    const payload = JSON.stringify(request.payload);
    const registered = this.deps.db.transaction(() => {
      const existing = getPendingInteractionByProviderRequest(this.deps.db, {
        providerId: request.providerId,
        providerThreadId: request.providerThreadId,
        providerRequestId: request.providerRequestId
      });
      if (existing) {
        if (existing.status !== 'pending' && existing.status !== 'resolving') {
          return {
            outcome: 'rejected' as const,
            reason: `Provider request ${request.providerRequestId} was already handled and cannot be reused`
          };
        }
        if (existing.payload !== payload) {
          return {
            outcome: 'rejected' as const,
            reason: `Provider request ${request.providerRequestId} is already awaiting a different interaction payload`
          };
        }
        return { outcome: 'existing' as const, row: existing };
      }
      if (getActivePendingInteractionForThread(this.deps.db, request.threadId)) {
        return {
          outcome: 'rejected' as const,
          reason: `Thread ${request.threadId} is already awaiting user interaction`
        };
      }
      return {
        outcome: 'created' as const,
        row: createPendingInteraction(this.deps.db, {
          threadId: request.threadId,
          turnId: request.turnId,
          originKind: 'provider',
          providerId: request.providerId,
          providerThreadId: request.providerThreadId,
          providerRequestId: request.providerRequestId,
          payload
        })
      };
    });

    if (registered.outcome === 'rejected') return registered;
    const pendingInteraction = toPendingInteraction(registered.row);
    if (registered.outcome === 'created') {
      appendPendingInteractionTimelineEvent(this.deps.db, this.deps.hub, pendingInteraction);
      notifyThread(this.deps, pendingInteraction.threadId);
    }
    return {
      outcome: registered.outcome,
      interactionId: pendingInteraction.id,
      status: pendingInteraction.status
    };
  }

  requestPluginInteraction(args: {
    pluginId: string;
    threadId: string;
    rendererId: string;
    title: string;
    payload: JsonValue;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<PluginInteractionResult> {
    const thread = getConversationThread(this.deps.db, args.threadId);
    if (!thread) {
      throw new ThreadCreateError(404, 'invalid_request', 'Thread does not exist');
    }
    if (args.signal?.aborted) {
      return Promise.resolve({ outcome: 'cancelled', reason: 'request-aborted' });
    }
    const expiresAt = Date.now() + args.timeoutMs;
    const row = this.deps.db.transaction(() => {
      if (getActivePendingInteractionForThread(this.deps.db, args.threadId)) {
        throw new ThreadCreateError(
          409,
          'invalid_request',
          `Thread ${args.threadId} is already awaiting user interaction`
        );
      }
      return createPendingInteraction(this.deps.db, {
        originKind: 'plugin',
        pluginId: args.pluginId,
        rendererId: args.rendererId,
        threadId: args.threadId,
        turnId: null,
        expiresAt,
        payload: JSON.stringify({
          kind: 'plugin',
          title: args.title,
          data: args.payload
        })
      });
    });
    const interaction = toPendingInteraction(row);
    const pending = new Promise<PluginInteractionResult>((resolve) => {
      const abort = () => {
        try {
          this.cancelPluginInteraction({
            interactionId: interaction.id,
            threadId: interaction.threadId,
            reason: 'request-aborted'
          });
        } catch {
          /* already settled */
        }
      };
      args.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => {
        try {
          this.cancelPluginInteraction({
            interactionId: interaction.id,
            threadId: interaction.threadId,
            reason: 'timeout'
          });
        } catch {
          /* already settled */
        }
      }, args.timeoutMs);
      this.pluginWaiters.set(interaction.id, {
        resolve,
        timer,
        removeAbortListener: () => args.signal?.removeEventListener('abort', abort)
      });
      if (args.signal?.aborted) abort();
    });
    try {
      appendPendingInteractionTimelineEvent(this.deps.db, this.deps.hub, interaction);
      notifyThread(this.deps, interaction.threadId);
    } catch (error) {
      setPendingInteractionInterrupted(this.deps.db, {
        id: interaction.id,
        statusReason: 'Plugin interaction setup failed'
      });
      this.settlePluginWaiter(interaction.id, { outcome: 'cancelled', reason: 'thread-stopped' });
      throw error;
    }
    return pending;
  }

  respondToPluginInteraction(args: {
    interactionId: string;
    threadId: string;
    value: JsonValue;
  }): PendingInteraction {
    if (jsonByteLength(args.value) > PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES) {
      throw new ThreadCreateError(400, 'invalid_request', 'Interaction response exceeds 64 KiB');
    }
    const current = this.getThreadInteraction(args);
    if (!isPluginPendingInteraction(current)) {
      throw new ThreadCreateError(400, 'invalid_request', 'Plugin interaction expected');
    }
    if (current.status !== 'pending') throw conflict(current);
    const updated = setPendingInteractionResolved(this.deps.db, {
      id: current.id,
      resolution: JSON.stringify({ kind: 'plugin_submitted' })
    });
    if (!updated) throw conflict(this.requireInteraction(current.id));
    const interaction = toPendingInteraction(updated);
    this.settlePluginWaiter(interaction.id, { outcome: 'submitted', value: args.value });
    this.settleTerminal(interaction);
    return interaction;
  }

  cancelPluginInteraction(args: {
    interactionId: string;
    threadId: string;
    reason: PluginInteractionCancelReason;
  }): PendingInteraction {
    const current = this.getThreadInteraction(args);
    if (!isPluginPendingInteraction(current)) {
      throw new ThreadCreateError(400, 'invalid_request', 'Plugin interaction expected');
    }
    if (current.status !== 'pending' && current.status !== 'resolving') throw conflict(current);
    const updated = setPendingInteractionInterrupted(this.deps.db, {
      id: current.id,
      statusReason: args.reason
    });
    if (!updated) throw conflict(this.requireInteraction(current.id));
    const interaction = toPendingInteraction(updated);
    this.settlePluginWaiter(interaction.id, { outcome: 'cancelled', reason: args.reason });
    this.settleTerminal(interaction);
    return interaction;
  }

  interruptPluginInteractions(pluginId: string): PendingInteraction[] {
    return this.settleInterruptedRows(
      interruptPendingInteractionsForPlugin(this.deps.db, {
        pluginId,
        statusReason: 'plugin-disposed'
      })
    );
  }

  async resolvePendingInteraction(args: {
    threadId: string;
    interactionId: string;
    resolution: PendingInteractionResolution;
  }): Promise<PendingInteraction> {
    const current = this.getThreadInteraction(args);
    if (current.status !== 'pending') {
      if (
        (current.status === 'resolving' || current.status === 'resolved')
        && pendingInteractionResolutionEquals(current.resolution, args.resolution)
      ) {
        return current;
      }
      throw conflict(current);
    }
    validatePendingInteractionResolution(current, args.resolution);
    if (isPluginPendingInteraction(current)) {
      throw new ThreadCreateError(
        400,
        'invalid_request',
        'Plugin interactions must be submitted through the respond endpoint'
      );
    }
    const resolving = setPendingInteractionResolving(this.deps.db, {
      id: current.id,
      resolution: JSON.stringify(args.resolution)
    });
    if (!resolving) throw conflict(this.requireInteraction(current.id));
    const queued = toPendingInteraction(resolving);
    appendPendingInteractionTimelineEvent(this.deps.db, this.deps.hub, queued);
    notifyThread(this.deps, queued.threadId);
    const thread = getConversationThread(this.deps.db, queued.threadId);
    if (!thread) {
      this.interruptOne(queued.id, 'thread-deleted');
      throw new ThreadCreateError(404, 'unknown-thread', 'thread is not registered');
    }
    try {
      await this.deps.callHostOnlineRpc({
        hostId: thread.hostId,
        command: {
          type: 'interactive.resolve',
          threadId: queued.threadId,
          interactionId: queued.id,
          providerId: queued.providerId,
          providerThreadId: queued.providerThreadId,
          providerRequestId: queued.providerRequestId,
          resolution: args.resolution
        }
      });
    } catch (error) {
      const reason = error instanceof HostUnavailableError
        ? 'host-unavailable'
        : error instanceof Error
          ? error.message
          : 'interactive-resolve-failed';
      this.interruptOne(queued.id, reason);
      throw error;
    }
    const completed = setPendingInteractionResolved(this.deps.db, {
      id: queued.id,
      resolution: JSON.stringify(args.resolution)
    });
    const interaction = toPendingInteraction(completed ?? resolving);
    this.settleTerminal(interaction);
    return interaction;
  }

  interruptPendingInteractionsForThreadIds(args: {
    threadIds: readonly string[];
    reason: string;
  }): PendingInteraction[] {
    return this.settleInterruptedRows(
      interruptPendingInteractionsForThreadIds(this.deps.db, {
        threadIds: args.threadIds,
        statusReason: args.reason
      })
    );
  }

  interruptPendingInteractionsForThreads(args: {
    providerId: string;
    threadIds: readonly string[];
    reason: string;
  }): PendingInteraction[] {
    return this.settleInterruptedRows(
      interruptPendingInteractionsForThreads(this.deps.db, {
        providerId: args.providerId,
        threadIds: args.threadIds,
        statusReason: args.reason
      })
    );
  }

  interruptPendingInteractionsForHost(hostId: string, reason: string): PendingInteraction[] {
    return this.interruptPendingInteractionsForThreadIds({
      threadIds: listActivePendingInteractionThreadIdsForHost(this.deps.db, hostId),
      reason
    });
  }

  private requireInteraction(id: string): PendingInteraction {
    return toPendingInteraction(this.requireInteractionRow(id));
  }

  private requireInteractionRow(id: string): PendingInteractionRow {
    const row = getPendingInteraction(this.deps.db, id);
    if (!row) throw new ThreadCreateError(404, 'invalid_request', 'Pending interaction not found');
    return row;
  }

  private interruptOne(id: string, reason: string): void {
    const updated = setPendingInteractionInterrupted(this.deps.db, { id, statusReason: reason });
    if (!updated) return;
    this.settleInterruptedRows([updated]);
  }

  private settleInterruptedRows(rows: PendingInteractionRow[]): PendingInteraction[] {
    const interactions = rows.map(toPendingInteraction);
    for (const interaction of interactions) {
      if (isPluginPendingInteraction(interaction)) {
        const reason = normalizePluginCancelReason(interaction.statusReason);
        this.settlePluginWaiter(interaction.id, { outcome: 'cancelled', reason });
      }
      this.settleTerminal(interaction);
    }
    return interactions;
  }

  private settleTerminal(interaction: PendingInteraction): void {
    appendPendingInteractionTimelineEvent(this.deps.db, this.deps.hub, interaction);
    notifyThread(this.deps, interaction.threadId);
    this.deps.onInteractionSettled?.({
      threadId: interaction.threadId,
      status: interaction.status,
      statusReason: interaction.statusReason ?? null
    });
  }

  private settlePluginWaiter(id: string, result: PluginInteractionResult): void {
    const waiter = this.pluginWaiters.get(id);
    if (!waiter) return;
    this.pluginWaiters.delete(id);
    clearTimeout(waiter.timer);
    waiter.removeAbortListener();
    waiter.resolve(result);
  }
}

function normalizePluginCancelReason(reason: string | null): PluginInteractionCancelReason {
  switch (reason) {
    case 'user':
    case 'request-aborted':
    case 'thread-stopped':
    case 'thread-deleted':
    case 'plugin-disposed':
    case 'server-restarted':
    case 'timeout':
      return reason;
    default:
      return 'thread-stopped';
  }
}

export { PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES };
