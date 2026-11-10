import { randomUUID } from 'node:crypto';
import type { InteractionActor } from '@zana-ai/zcc-domain';
import {
  PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES,
  type JsonValue
} from '@zana-ai/zcc-domain/thread-runtime';
import { ThreadCreateError } from '../../http/thread-create.js';
import { humanGateRefusal, type RequireHuman } from './human-gate.js';
import type { PluginInteractionCancelReason, PluginInteractionResult } from './pending-interactions.js';

/**
 * The identity an interaction waits under. A conversation thread has a row and
 * is keyed by `threadId`; a PTY session main owns has none and is keyed by
 * `sessionId`. Exactly one of the two is set, and `projectId` is always the one
 * main asserted from its live session.
 */
export interface PendingInteractionKey {
  threadId?: string;
  sessionId?: string;
  projectId: string;
}

/** What the Agents monitor renders: the same plugin form payload a thread card gets. */
export interface PtyInteractionView {
  id: string;
  sessionId: string;
  projectId: string;
  status: 'pending';
  origin: { kind: 'plugin'; pluginId: string; rendererId: string };
  payload: { kind: 'plugin'; title: string; data: JsonValue; requireHuman: RequireHuman };
  createdAt: number;
  expiresAt: number;
}

interface LiveSession {
  sessionId: string;
  projectId: string;
}

interface Entry {
  view: PtyInteractionView;
  resolve: (result: PluginInteractionResult) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener: () => void;
}

/** Live PTY sessions remembered at once; the oldest idle one is forgotten past it. */
export const PTY_INTERACTION_MAX_SESSIONS = 4_096;

export interface PtyInteractionStoreDeps {
  /** Called after any change to a session's open interactions, so the monitor can re-read. */
  onChanged?: (change: { sessionId: string; projectId: string }) => void;
}

function notFound(): ThreadCreateError {
  return new ThreadCreateError(404, 'invalid_request', 'Pending interaction not found');
}

/**
 * `ui.requestInput` for PTY sessions. Interactions live in memory only: the
 * plugin awaiting an answer dies with the server, so nothing outlives the
 * process that could answer it. A session is known once main reports it live
 * (lifecycle events carry main's own identity, never renderer input) and
 * forgotten when main reports it ended, which cancels what it still waits on.
 */
export class PtyInteractionStore {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly entries = new Map<string, Entry>();
  private readonly bySession = new Map<string, string>();
  private readonly deps: PtyInteractionStoreDeps;

  constructor(deps: PtyInteractionStoreDeps = {}) {
    this.deps = deps;
  }

  /** Main reports a session live (created, active, or idle). Idempotent. */
  noteSession(session: LiveSession): void {
    const known = this.sessions.get(session.sessionId);
    if (known) {
      // Identity is fixed by first sight; a later report naming another project is ignored.
      return;
    }
    if (this.sessions.size >= PTY_INTERACTION_MAX_SESSIONS) {
      for (const id of this.sessions.keys()) {
        if (!this.bySession.has(id)) {
          this.sessions.delete(id);
          break;
        }
      }
      if (this.sessions.size >= PTY_INTERACTION_MAX_SESSIONS) return;
    }
    this.sessions.set(session.sessionId, { sessionId: session.sessionId, projectId: session.projectId });
  }

  /** Main reports a session ended (failed or deleted): cancel its open interaction. */
  endSession(sessionId: string): void {
    const id = this.bySession.get(sessionId);
    if (id) this.settle(id, { outcome: 'cancelled', reason: 'thread-stopped' });
    this.sessions.delete(sessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  request(args: {
    pluginId: string;
    sessionId: string;
    rendererId: string;
    title: string;
    payload: JsonValue;
    timeoutMs: number;
    requireHuman?: RequireHuman;
    signal?: AbortSignal;
  }): Promise<PluginInteractionResult> {
    const session = this.sessions.get(args.sessionId);
    if (!session) {
      throw new ThreadCreateError(404, 'invalid_request', 'PTY session is not live');
    }
    if (args.signal?.aborted) return Promise.resolve({ outcome: 'cancelled', reason: 'request-aborted' });
    if (this.bySession.has(args.sessionId)) {
      throw new ThreadCreateError(
        409,
        'invalid_request',
        `PTY session ${args.sessionId} is already awaiting user interaction`
      );
    }
    const createdAt = Date.now();
    const view: PtyInteractionView = {
      id: randomUUID(),
      sessionId: session.sessionId,
      projectId: session.projectId,
      status: 'pending',
      origin: { kind: 'plugin', pluginId: args.pluginId, rendererId: args.rendererId },
      payload: { kind: 'plugin', title: args.title, data: args.payload, requireHuman: args.requireHuman ?? false },
      createdAt,
      expiresAt: createdAt + args.timeoutMs
    };
    if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
      return Promise.resolve({ outcome: 'cancelled', reason: 'timeout' } as PluginInteractionResult);
    }
    return new Promise<PluginInteractionResult>((resolve) => {
      const abort = () => this.settle(view.id, { outcome: 'cancelled', reason: 'request-aborted' });
      args.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => this.settle(view.id, { outcome: 'cancelled', reason: 'timeout' }), args.timeoutMs);
      this.entries.set(view.id, {
        view,
        resolve,
        timer,
        removeAbortListener: () => args.signal?.removeEventListener('abort', abort)
      });
      this.bySession.set(session.sessionId, view.id);
      this.changed(view);
    });
  }

  list(sessionId: string): PtyInteractionView[] {
    const id = this.bySession.get(sessionId);
    const entry = id ? this.entries.get(id) : undefined;
    return entry ? [entry.view] : [];
  }

  respond(args: { sessionId: string; interactionId: string; value: JsonValue; actor?: InteractionActor; attestation?: 'window' | 'sheet' }): PtyInteractionView {
    if (Buffer.byteLength(JSON.stringify(args.value) ?? 'null', 'utf8') > PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES) {
      throw new ThreadCreateError(400, 'invalid_request', 'Interaction response exceeds 64 KiB');
    }
    const entry = this.require(args);
    if (entry.view.expiresAt <= Date.now()) {
      // The timer may be delayed; an overdue interaction is never answerable.
      this.settle(entry.view.id, { outcome: 'cancelled', reason: 'timeout' });
      throw new ThreadCreateError(409, 'interaction_expired', 'Interaction has expired');
    }
    const actor = args.actor ?? 'unknown';
    const refusal = humanGateRefusal(entry.view.payload.requireHuman, actor, args.attestation, {
      title: entry.view.payload.title, pluginId: entry.view.origin.pluginId
    });
    if (refusal) throw refusal;
    this.settle(entry.view.id, { outcome: 'submitted', value: args.value, actor });
    return entry.view;
  }

  cancel(args: { sessionId: string; interactionId: string; reason: PluginInteractionCancelReason }): PtyInteractionView {
    const entry = this.require(args);
    this.settle(entry.view.id, { outcome: 'cancelled', reason: args.reason });
    return entry.view;
  }

  /** A plugin was disposed or reloaded: its open interactions can never be answered. */
  interruptForPlugin(pluginId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.view.origin.pluginId === pluginId) this.settle(entry.view.id, { outcome: 'cancelled', reason: 'plugin-disposed' });
    }
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.settle(id, { outcome: 'cancelled', reason: 'server-restarted' });
    this.sessions.clear();
  }

  private require(args: { sessionId: string; interactionId: string }): Entry {
    const entry = this.entries.get(args.interactionId);
    // A different session's id is indistinguishable from an unknown one.
    if (!entry || entry.view.sessionId !== args.sessionId) throw notFound();
    return entry;
  }

  private settle(id: string, result: PluginInteractionResult): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.bySession.delete(entry.view.sessionId);
    clearTimeout(entry.timer);
    entry.removeAbortListener();
    entry.resolve(result);
    this.changed(entry.view);
  }

  private changed(view: PtyInteractionView): void {
    try {
      this.deps.onChanged?.({ sessionId: view.sessionId, projectId: view.projectId });
    } catch {
      /* a failed notification never changes what a plugin is told */
    }
  }
}
