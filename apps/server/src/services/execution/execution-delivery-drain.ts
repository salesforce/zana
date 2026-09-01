/**
 * Re-announces durable blocker responses when their worker returns to a prompt.
 * The worker remains responsible for pulling and acknowledging payload bodies.
 */
import type { AgentState } from '@zana-ai/zcc-domain/product';
import { isRestfulAgentState } from '@zana-ai/zcc-domain/product';

export interface ExecutionDeliveryDrainDeps {
  pending: (sessionId: string) => Promise<Array<{ id: string; executionId: string }>>;
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
    const queuedIds = new Set(queued.map((delivery) => delivery.id));
    for (const id of entry.announced) {
      if (!queuedIds.has(id)) entry.announced.delete(id);
    }
    const fresh = queued.filter((delivery) => !entry.announced.has(delivery.id));
    if (fresh.length === 0 || !this.deps.isRestful(sessionId)) return;
    const executions = [...new Set(queued.map((delivery) => delivery.executionId))];
    const count = queued.length;
    const sent = this.deps.reply(
      sessionId,
      `[execution] You have ${count} pending blocker ${count === 1 ? 'response' : 'responses'} ` +
        `for ${executions.join(', ')}. Call execution.delivery.pull, handle one response, then call execution.delivery.ack.`
    );
    if (sent) for (const delivery of queued) entry.announced.add(delivery.id);
  }
}
