/**
 * AgentMessageLog — the agent↔agent message channel (Phase 1 of the agent mesh).
 *
 * ## This is NOT the user inbox
 *
 * The user inbox (`InboxStore` / `inbox_push`) is the **agent → User** channel —
 * the cockpit pilot's actionable surface. THIS store is the **agent ↔ agent**
 * channel: peer messages must never pollute the user inbox. `agent_send` writes
 * here, never to `InboxStore`. The mesh touches the user inbox only on a genuine
 * human-in-the-loop event (a first-send permission prompt, or a blocked
 * escalation) — never for routine peer traffic. Keeping these channels separate
 * is the load-bearing rule of the design (`docs/tmux-agent-mesh-review.md`).
 *
 * ## Two roles, one store
 *
 *  1. **Audit log** — every send is appended, durably ordered, and surfaced to
 *     the user in an Agents/activity view so cross-agent traffic is always
 *     visible and attributable to a real session.
 *  2. **Per-target pull queue** — the queue IS the delivery source of truth.
 *     `agent_send` enqueues here; the target drains its queue via `agent_inbox`.
 *     A best-effort inject into the target's pty (when it's idle) is layered on
 *     top, but the queue is authoritative — so a missed/declined inject means
 *     "still queued", never "lost". This is what makes the debounced idle-gate
 *     safe (`AgentStatusTracker` can be ~250ms stale).
 *
 * ## Why in-memory (no persistence)
 *
 * Like {@link AgentRegistryStore}, messages are tied to live sessions whose ids
 * don't survive an app restart (PTYs are re-spawned with fresh ids in Phase 0).
 * A persisted log would only reference dead sessions. Persistence becomes
 * meaningful once sessions persist (the tmux work in Phase 2); that's the seam
 * to add it. The store mirrors the inbox-store shape (factory + EventEmitter +
 * dispose-returning subscriptions) so the renderer/IPC wiring is identical.
 *
 * ## In-process Agent-tool subagents are INVISIBLE here
 *
 * This log carries ONLY cross-tab (peer-session) traffic — `agent_send` between
 * agents that each have their own pty session + MCP route. In-process subagents
 * spawned via the client-side `Agent` tool are NOT in this store: they have no
 * pty session and no MCP route, so they can't call `agent_send`, and the client
 * delivers their result INLINE into the parent agent's context. The Electron
 * main process never observes them. An orchestrator collecting results must read
 * an in-process subagent's output directly from its own context — polling
 * `agent_inbox` (which drains this log) will never surface it.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { AgentMessage } from '../shared/types.js';

export type { AgentMessage } from '../shared/types.js';

/**
 * Hard count-based retention cap on the in-memory log (rule #5: an unbounded
 * accumulating store needs a retention cap). The periodic time-prune
 * ({@link IAgentMessageLog.prune}) handles NORMAL aging — dropping messages
 * older than ~1h on a 5-minute sweep. This cap is the BACKSTOP against the
 * worst case the time-prune can't catch: a runaway loop that appends thousands
 * of messages *within* a single sweep window, filling memory fast. Enforced on
 * every {@link IAgentMessageLog.append}, it bounds the array to the newest
 * `AGENT_MESSAGE_MAX_MESSAGES` regardless of age. Mirrors inbox-store's cap.
 */
export const AGENT_MESSAGE_MAX_MESSAGES = 5000;

/**
 * Slack over the cap before we trim, to amortize the splice cost: rather than
 * trimming on every append past the ceiling, we let the array overshoot by this
 * much and trim in one pass (~once per 500 appends), matching inbox-store's
 * `compactionSlack` amortization.
 */
const AGENT_MESSAGE_TRIM_SLACK = 500;

/** Fields a caller provides to {@link IAgentMessageLog.append}. */
export interface AgentMessageInput {
  fromSessionId: string;
  fromHandle: string;
  toSessionId: string;
  toHandle: string;
  projectId: string;
  body: string;
  /** If the message was injected synchronously, mark it delivered up front. */
  deliveredAt?: number;
}

export interface IAgentMessageLog {
  /** Append a message (audit + enqueue). Returns the stored message. */
  append(input: AgentMessageInput): AgentMessage;
  /**
   * Undelivered messages addressed to a session, oldest first. With `since`
   * (a message id previously seen), returns only messages after it. Does NOT
   * mutate — call {@link markDelivered} to drain.
   */
  pull(toSessionId: string, since?: string): AgentMessage[];
  /** Mark messages delivered (drains them from `pull`). */
  markDelivered(ids: string[]): void;
  /** All messages (audit history), oldest first, optionally scoped to a project. */
  history(projectId?: string): AgentMessage[];
  /**
   * Drop messages older than `maxAgeMs` (by `ts`). Returns the ids removed so a
   * caller can push the eviction to the renderer. A no-op (returns `[]`) when
   * nothing is stale. This is the retention cap for the in-memory log — without
   * it a long-lived session would accumulate peer traffic unboundedly.
   */
  prune(maxAgeMs: number): string[];
  /** Subscribe to appends (for the activity view). Returns a dispose function. */
  onAppended(listener: (msg: AgentMessage) => void): () => void;
  /** Subscribe to prunes (so the renderer can drop evicted rows). Returns a dispose function. */
  onPruned(listener: (removedIds: string[]) => void): () => void;
}

export function createAgentMessageLog(): IAgentMessageLog {
  const messages: AgentMessage[] = [];
  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  function append(input: AgentMessageInput): AgentMessage {
    const msg: AgentMessage = {
      ...input,
      id: randomUUID(),
      ts: Date.now()
    };
    messages.push(msg);
    // Emit 'appended' BEFORE the count-cap trim — the trim is housekeeping, not
    // part of append's contract (matches inbox-store's ordering).
    emitter.emit('appended', msg);
    // Count-based retention backstop (see AGENT_MESSAGE_MAX_MESSAGES). Let the
    // array overshoot by AGENT_MESSAGE_TRIM_SLACK, then trim the oldest overflow
    // in one pass so exactly the newest AGENT_MESSAGE_MAX_MESSAGES remain. Reuse
    // the 'pruned' channel — the renderer already drops evicted rows on it.
    if (messages.length > AGENT_MESSAGE_MAX_MESSAGES + AGENT_MESSAGE_TRIM_SLACK) {
      const removed = messages
        .splice(0, messages.length - AGENT_MESSAGE_MAX_MESSAGES)
        .map((m) => m.id);
      if (removed.length > 0) emitter.emit('pruned', removed);
    }
    return msg;
  }

  function pull(toSessionId: string, since?: string): AgentMessage[] {
    let start = 0;
    if (since) {
      const idx = messages.findIndex((m) => m.id === since);
      // Fallback: if the cursor message was trimmed away (by the count cap or
      // time-prune), findIndex returns -1 and start stays 0 — we return ALL
      // undelivered messages for the target rather than silently dropping them.
      if (idx >= 0) start = idx + 1;
    }
    return messages
      .slice(start)
      .filter((m) => m.toSessionId === toSessionId && m.deliveredAt === undefined);
  }

  function markDelivered(ids: string[]): void {
    if (ids.length === 0) return;
    const set = new Set(ids);
    const now = Date.now();
    for (const m of messages) {
      if (set.has(m.id) && m.deliveredAt === undefined) m.deliveredAt = now;
    }
  }

  function history(projectId?: string): AgentMessage[] {
    return projectId ? messages.filter((m) => m.projectId === projectId) : [...messages];
  }

  function prune(maxAgeMs: number): string[] {
    if (maxAgeMs <= 0) return [];
    const cutoff = Date.now() - maxAgeMs;
    const removed: string[] = [];
    // Filter in place: the array stays oldest-first, and a single pass drops the
    // stale prefix (and any stragglers) while collecting their ids for the push.
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].ts < cutoff) {
        removed.push(messages[i].id);
        messages.splice(i, 1);
      }
    }
    if (removed.length > 0) emitter.emit('pruned', removed);
    return removed;
  }

  function onAppended(listener: (msg: AgentMessage) => void): () => void {
    emitter.on('appended', listener);
    return () => {
      emitter.off('appended', listener);
    };
  }

  function onPruned(listener: (removedIds: string[]) => void): () => void {
    emitter.on('pruned', listener);
    return () => {
      emitter.off('pruned', listener);
    };
  }

  return { append, pull, markDelivered, history, prune, onAppended, onPruned };
}
