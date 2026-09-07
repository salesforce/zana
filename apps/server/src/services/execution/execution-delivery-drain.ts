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
}

interface Entry {
  lastState: AgentState;
  announced: Set<string>;
}

const restful = isRestfulAgentState;

export class ExecutionDeliveryDrainService {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly deps: ExecutionDeliveryDrainDeps) {}

  observe(sessionId: string, state: AgentState): void {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { lastState: 'unknown', announced: new Set() };
      this.entries.set(sessionId, entry);
    }
    const previous = entry.lastState;
    entry.lastState = state;
    if (previous === state || !restful(state)) return;
    void this.announce(sessionId, entry);
  }

  forceCheck(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry && restful(entry.lastState)) {
      void this.announce(sessionId, entry);
    }
  }

  remove(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  private async announce(sessionId: string, entry: Entry): Promise<void> {
    const queued = await this.deps.pending(sessionId).catch(() => []);
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
    if (fresh.length === 0 || !this.deps.isRestful(sessionId)) return;
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
