/**
 * Action queue — decouples the synchronous key-press callback from the async
 * control-plane round-trip. A press enqueues an Intent and returns immediately
 * (so the HID thread never blocks and the button feels instant); a single
 * worker drains the queue in order, making one control-plane call per intent.
 *
 * This is the interaction half of the showcase adaptation: where the original
 * fired synthetic keystrokes at the focused window, an Intent here becomes an
 * explicit, addressed RPC (`agent.send` / `term.reply`).
 */

import type { ZccSource } from './zcc-source.js';
import type { SpawnProfile } from './types.js';

export type Intent =
  | { kind: 'send'; to: string; message: string }
  | { kind: 'reply'; sessionId: string; text: string }
  | { kind: 'spawn'; projectId: string; profile: SpawnProfile }
  | { kind: 'sched-run'; id: string }
  | { kind: 'sched-toggle'; id: string; enabled: boolean }
  | { kind: 'focus'; sessionId: string; projectId: string };

export interface DispatchResult {
  intent: Intent;
  ok: boolean;
  code?: string;
  message?: string;
}

export class ActionQueue {
  private queue: Intent[] = [];
  private draining = false;

  constructor(
    private readonly source: ZccSource,
    /** Called after each intent resolves — drives optimistic-UI reconciliation / logging. */
    private readonly onResult?: (r: DispatchResult) => void
  ) {}

  /** Enqueue an intent. Non-blocking; safe to call from a key-press handler. */
  enqueue(intent: Intent): void {
    this.queue.push(intent);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let intent: Intent | undefined;
      while ((intent = this.queue.shift())) {
        const res = await this.dispatch(intent);
        this.onResult?.({
          intent,
          ok: res.ok,
          code: res.code,
          message: res.message
        });
      }
    } finally {
      this.draining = false;
    }
  }

  /** Route one intent to its control-plane op. Each arm resolves (never rejects). */
  private dispatch(intent: Intent) {
    switch (intent.kind) {
      case 'send':
        return this.source.sendToAgent(intent.to, intent.message);
      case 'reply':
        return this.source.replyToSession(intent.sessionId, intent.text);
      case 'spawn':
        return this.source.spawnAgent(intent.projectId, intent.profile);
      case 'sched-run':
        return this.source.runScheduleNow(intent.id);
      case 'sched-toggle':
        return this.source.setScheduleEnabled(intent.id, intent.enabled);
      case 'focus':
        return this.source.focusAgent(intent.sessionId, intent.projectId);
    }
  }

  /** Pending intent count — for tests / status display. */
  get pending(): number {
    return this.queue.length;
  }
}
