/**
 * AgentMailDrain — nudge an agent to read its queued peer mail when it goes idle.
 *
 * ## The gap this closes
 *
 * The agent mesh delivers peer messages "pull-first, inject-when-idle"
 * (`agent-messaging-mcp-tools.ts`): `agent_send` always enqueues, and injects at
 * the target's prompt ONLY if the target is idle *at send time*. If the target
 * is busy, the message just sits in the queue — and nothing ever told the busy
 * agent it had mail. It would only surface if the agent spontaneously called
 * `agent_inbox`, which it has no reliable trigger to do. So a message sent to a
 * working peer routinely sat undelivered: the sender saw "Queued… it will see
 * this when it next checks", but the recipient never checked. That asymmetry is
 * the "weird pickup" users hit.
 *
 * This service is the missing half: it watches the SAME resolved-state edge that
 * drives idle-triage and heartbeat, and on the transition INTO `idle`/`done` it
 * checks the target's queue and, if non-empty, injects a single coalesced
 * announcement telling the agent to run `agent_inbox`.
 *
 * ## Announce-only, never mark delivered
 *
 * It deliberately does NOT inject message bodies and does NOT mark them
 * delivered. The queue stays the single source of truth: the announcement is
 * just a nudge, so a missed/ignored one simply gets re-announced on the next
 * idle edge (idempotent). The agent reads the actual bodies through the
 * authoritative `agent_inbox` pull, which is where `markDelivered` happens. This
 * sidesteps the mid-turn-injection race entirely — we never lose a body to a
 * mistimed inject because we never inject bodies here.
 *
 * To avoid re-announcing the same backlog on every idle flicker, we remember the
 * message ids already announced per session and only nudge when genuinely NEW
 * mail has arrived since the last announcement. Once the agent drains via
 * `agent_inbox`, those ids leave the queue, so the set naturally shrinks.
 *
 * Fires on `idle`/`done` ONLY — never `blocked` (a permission prompt / question
 * is left untouched, so an announcement can't be misread as answering a security
 * prompt). All collaborators are injected, mirroring {@link HeartbeatService} /
 * {@link IdleTriageService}, so the trigger logic is unit-testable without
 * Electron or a real pty.
 */

import type { AgentState } from '@zana-ai/zcc-domain/product';

export interface AgentMailDrainDeps {
  /** Queued (undelivered) messages addressed to a session, oldest first. */
  pending: (sessionId: string) => { id: string; fromHandle: string }[];
  /** Inject a line at the session's prompt (body + deferred CR). False if gone. */
  reply: (sessionId: string, text: string) => boolean;
}

/** Per-session memory of which queued ids we've already announced. */
interface Entry {
  lastState: AgentState;
  announced: Set<string>;
}

/** States in which it's safe to nudge an agent at its prompt. */
function isRestful(state: AgentState): boolean {
  return state === 'idle' || state === 'done';
}

export class AgentMailDrainService {
  private entries = new Map<string, Entry>();

  constructor(private readonly deps: AgentMailDrainDeps) {}

  /**
   * Feed a session's newly-resolved agent state. On the edge INTO idle/done,
   * announce any queued peer mail the agent hasn't been told about yet. Cheap
   * and synchronous on the hot path: a queue read + (rarely) one inject.
   */
  observe(sessionId: string, state: AgentState): void {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { lastState: 'unknown', announced: new Set() };
      this.entries.set(sessionId, entry);
    }
    const prev = entry.lastState;
    entry.lastState = state;
    if (state === prev) return; // not an edge
    if (!isRestful(state)) return; // only nudge when at rest, never while blocked

    const queued = this.deps.pending(sessionId);
    if (queued.length === 0) {
      // Nothing pending — the agent has caught up, so forget what we announced.
      entry.announced.clear();
      return;
    }
    // Prune the announced set to what's still queued (drained ids fall away),
    // then announce only when genuinely-new mail has arrived since last time.
    const queuedIds = new Set(queued.map((m) => m.id));
    for (const id of [...entry.announced]) {
      if (!queuedIds.has(id)) entry.announced.delete(id);
    }
    const fresh = queued.filter((m) => !entry.announced.has(m.id));
    if (fresh.length === 0) return; // already nudged about this exact backlog

    const senders = [...new Set(queued.map((m) => `@${m.fromHandle}`))].join(', ');
    const n = queued.length;
    const announcement =
      `[mesh] You have ${n} unread peer ${n === 1 ? 'message' : 'messages'} ` +
      `(from ${senders}). Call agent_inbox to read ${n === 1 ? 'it' : 'them'}.`;
    const sent = this.deps.reply(sessionId, announcement);
    if (sent) for (const m of queued) entry.announced.add(m.id);
  }

  /** Forget a session (call on pty exit). */
  remove(sessionId: string): void {
    this.entries.delete(sessionId);
  }
}
