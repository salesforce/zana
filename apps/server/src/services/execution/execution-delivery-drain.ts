/**
 * Re-announces durable blocker responses when their worker returns to a prompt.
 * The worker remains responsible for pulling and acknowledging payload bodies.
 */
import type { AgentState } from '@zana-ai/zcc-domain/product';
import { isRestfulAgentState } from '@zana-ai/zcc-domain/product';

export interface ExecutionDeliveryDrainDeps {
  pending: (sessionId: string) => Promise<Array<{ id: string; executionId: string; attempt: number }>>;
  isRestful: (sessionId: string) => boolean;
  reply: (sessionId: string, text: string) => boolean;
  logError?: (message: string, error: unknown) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Entry {
  lastState: AgentState;
  announced: Set<string>;
  retries: number;
  retryTimer?: unknown;
}

const restful = isRestfulAgentState;
const MAX_PENDING_RETRIES = 3;
const PENDING_RETRY_MS = 2_000;

export class ExecutionDeliveryDrainService {
  private readonly entries = new Map<string, Entry>();
  // Serializes announce() per session so a concurrent observe()/forceCheck()
  // burst can't run two overlapping pending()->reply() passes and double-announce.
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly logError: (message: string, error: unknown) => void;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: ExecutionDeliveryDrainDeps) {
    this.logError = deps.logError ?? ((message, error) => console.error(message, error));
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  observe(sessionId: string, state: AgentState): void {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { lastState: 'unknown', announced: new Set(), retries: 0 };
      this.entries.set(sessionId, entry);
    }
    const previous = entry.lastState;
    entry.lastState = state;
    if (previous === state || !restful(state)) return;
    this.schedule(sessionId, entry);
  }

  forceCheck(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry && restful(entry.lastState)) {
      this.schedule(sessionId, entry);
    }
  }

  remove(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry?.retryTimer !== undefined) this.clearTimer(entry.retryTimer);
    this.entries.delete(sessionId);
    this.inFlight.delete(sessionId);
  }

  private schedule(sessionId: string, entry: Entry): void {
    const prior = this.inFlight.get(sessionId) ?? Promise.resolve();
    const next = prior.then(() => this.announce(sessionId, entry)).catch(() => {});
    this.inFlight.set(sessionId, next);
    void next.finally(() => {
      if (this.inFlight.get(sessionId) === next) this.inFlight.delete(sessionId);
    });
  }

  private scheduleRetry(sessionId: string, entry: Entry): void {
    if (this.entries.get(sessionId) !== entry) return;
    if (entry.retries >= MAX_PENDING_RETRIES || !this.deps.isRestful(sessionId)) return;
    entry.retries += 1;
    if (entry.retryTimer !== undefined) this.clearTimer(entry.retryTimer);
    entry.retryTimer = this.setTimer(() => {
      entry.retryTimer = undefined;
      if (this.entries.get(sessionId) === entry) this.schedule(sessionId, entry);
    }, PENDING_RETRY_MS);
  }

  private async announce(sessionId: string, entry: Entry): Promise<void> {
    // The entry may have been removed (session exit) between scheduling and now.
    if (this.entries.get(sessionId) !== entry || !this.deps.isRestful(sessionId)) return;

    let queued: Array<{ id: string; executionId: string; attempt: number }>;
    try {
      queued = await this.deps.pending(sessionId);
    } catch (error) {
      this.logError(`execution-delivery-drain: pending lookup failed for session ${sessionId}`, error);
      this.scheduleRetry(sessionId, entry);
      return;
    }
    // Re-validate after the await: state/liveness can drift during the lookup.
    if (this.entries.get(sessionId) !== entry || !this.deps.isRestful(sessionId)) return;
    entry.retries = 0;

    // Key the announced-suppression by delivery id AND attempt. A delivery whose
    // worker acked delivered:false reverts to PENDING with its attempt bumped by
    // the failed pull, so its key changes — the drain then RE-announces it on the
    // worker's next restful edge instead of suppressing it forever. Without the
    // attempt in the key, a prompt-obeying worker (which pulls only after a nudge,
    // never polls) reports one transient failure and is then stranded: the same
    // id stays in `announced`, no further nudge is sent, and the re-PENDING
    // delivery never gets re-pulled. An UNCHANGED delivery (same attempt) still
    // suppresses on an idle flicker — that invariant is preserved.
    const keyOf = (delivery: { id: string; attempt: number }): string => `${delivery.id}:${delivery.attempt}`;
    const queuedKeys = new Set(queued.map(keyOf));
    for (const key of entry.announced) {
      if (!queuedKeys.has(key)) entry.announced.delete(key);
    }
    const fresh = queued.filter((delivery) => !entry.announced.has(keyOf(delivery)));
    if (fresh.length === 0) return;
    const executions = [...new Set(queued.map((delivery) => delivery.executionId))];
    const count = queued.length;
    const sent = this.deps.reply(
      sessionId,
      `[execution] You have ${count} pending blocker ${count === 1 ? 'response' : 'responses'} ` +
        `for ${executions.join(', ')}. Call execution.delivery.pull, handle one response, then call execution.delivery.ack.`
    );
    if (sent) for (const delivery of queued) entry.announced.add(keyOf(delivery));
  }
}
