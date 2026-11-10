import type { PtyLifecycleEventMainRequest } from '@zana-ai/zcc-contracts/runtime';
import {
  NATIVE_TOOL_POLICY_PROOF_HEADER,
  PTY_LIFECYCLE_EVENT_PATH,
  signNativeToolPolicyRequest
} from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import type { ProductRouteToolPolicyDeps } from './native-tool-policy.js';

export type PtyLifecycleSink = (request: PtyLifecycleEventMainRequest) => Promise<unknown>;

/** The product server's lifecycle route, for when no runtime supervisor runs (electron-vite dev). */
export function productRoutePtyLifecycleSink(deps: ProductRouteToolPolicyDeps): PtyLifecycleSink {
  return async (request) => {
    const body = JSON.stringify(request);
    const response = await (deps.fetch ?? fetch)(new URL(PTY_LIFECYCLE_EVENT_PATH, deps.serverUrl()), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [NATIVE_TOOL_POLICY_PROOF_HEADER]: signNativeToolPolicyRequest(deps.credential(), body)
      },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 12_000)
    });
    if (!response.ok) throw new Error(`product server answered HTTP ${response.status}`);
    return await response.json();
  };
}

/** What the emitter reads from a live PTY session record; always main's own, never renderer input. */
export interface PtyLifecycleSession {
  id: string;
  projectId: string;
  threadId?: string;
  profile: string;
  status?: string;
}

export interface PtyLifecycleEmitterDeps {
  /** The supervised runtime channel, or null when none runs. */
  supervised(): PtyLifecycleSink | null;
  /** The signed product route, or null outside electron-vite dev. */
  productRoute(): PtyLifecycleSink | null;
  log(message: string): void;
  /** Per-delivery ceiling; a stuck plugin host must not wedge the drain. */
  timeoutMs?: number;
  /** Undelivered events kept; the oldest are dropped past it. */
  maxQueue?: number;
  /** Live sessions tracked at once. */
  maxTracked?: number;
}

export const PTY_LIFECYCLE_DEFAULT_TIMEOUT_MS = 5_000;
export const PTY_LIFECYCLE_DEFAULT_MAX_QUEUE = 256;
export const PTY_LIFECYCLE_DEFAULT_MAX_TRACKED = 1_024;
const TOMBSTONES = 512;
const ERROR_MAX_CHARS = 1_024;

type TrackedState = 'created' | 'active' | 'idle';
interface Tracked { projectId: string; threadId?: string; profile: string; state: TrackedState }

/**
 * Turns PTY session moments into plugin lifecycle events without ever taking
 * time from the PTY. Callers hand over a moment synchronously; delivery happens
 * later, in order, through one bounded queue with a per-delivery timeout.
 *
 * Identity is main's own: it is recorded from the live session record when the
 * session is first seen, and a hook callback that names another project than
 * the session's own is ignored, so an event can never be attributed across
 * projects. Nothing here subscribes to anything; the caller wires it once at
 * app init and calls {@link PtyLifecycleEmitter.dispose} on shutdown.
 */
export function createPtyLifecycleEmitter(deps: PtyLifecycleEmitterDeps) {
  const timeoutMs = deps.timeoutMs ?? PTY_LIFECYCLE_DEFAULT_TIMEOUT_MS;
  const maxQueue = deps.maxQueue ?? PTY_LIFECYCLE_DEFAULT_MAX_QUEUE;
  const maxTracked = deps.maxTracked ?? PTY_LIFECYCLE_DEFAULT_MAX_TRACKED;
  const tracked = new Map<string, Tracked>();
  const exited = new Set<string>();
  const queue: PtyLifecycleEventMainRequest[] = [];
  let draining = false;
  let disposed = false;
  let dropped = 0;

  function enqueue(sessionId: string, entry: Tracked, kind: PtyLifecycleEventMainRequest['kind'], error?: string): void {
    if (disposed) return;
    queue.push({
      kind,
      sessionId,
      ...(entry.threadId ? { threadId: entry.threadId } : {}),
      projectId: entry.projectId,
      profile: entry.profile,
      ...(error ? { error: error.slice(0, ERROR_MAX_CHARS) } : {})
    });
    if (queue.length > maxQueue) {
      queue.shift();
      dropped += 1;
      if (dropped === 1 || dropped % 100 === 0) deps.log(`pty lifecycle queue full; dropped ${dropped} event(s)`);
    }
    if (!draining) {
      draining = true;
      void Promise.resolve().then(drain);
    }
  }

  async function deliver(request: PtyLifecycleEventMainRequest): Promise<void> {
    const sink = deps.supervised() ?? deps.productRoute();
    if (!sink) {
      deps.log('pty lifecycle event dropped: no plugin channel');
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        sink(request),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
        })
      ]);
    } catch (error) {
      deps.log(`pty lifecycle ${request.kind} for ${request.sessionId.slice(0, 8)} failed: ${String(error)}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function drain(): Promise<void> {
    try {
      while (!disposed) {
        const next = queue.shift();
        if (!next) break;
        await deliver(next);
      }
    } finally {
      draining = false;
      // An event queued while the last delivery settled must not be stranded.
      if (!disposed && queue.length > 0) {
        draining = true;
        void Promise.resolve().then(drain);
      }
    }
  }

  return {
    /** A session record changed. The first sighting of a live session is its creation. */
    observe(session: PtyLifecycleSession): void {
      if (disposed || tracked.has(session.id) || exited.has(session.id) || session.status === 'exited') return;
      if (tracked.size >= maxTracked) {
        deps.log('pty lifecycle tracking is full; session emits no lifecycle events');
        return;
      }
      const entry: Tracked = {
        projectId: session.projectId,
        ...(session.threadId ? { threadId: session.threadId } : {}),
        profile: session.profile,
        state: 'created'
      };
      tracked.set(session.id, entry);
      enqueue(session.id, entry, 'created');
    },
    /** A turn began or resumed (the unblocked callback). Repeats while already active are silent. */
    turnStarted(sessionId: string, projectId: string): void {
      const entry = tracked.get(sessionId);
      if (!entry || entry.projectId !== projectId || entry.state === 'active') return;
      entry.state = 'active';
      enqueue(sessionId, entry, 'active');
    },
    /** A turn ended (the stop callback). */
    turnFinished(sessionId: string, projectId: string): void {
      const entry = tracked.get(sessionId);
      if (!entry || entry.projectId !== projectId || entry.state === 'idle') return;
      entry.state = 'idle';
      enqueue(sessionId, entry, 'idle');
    },
    /**
     * The process ended. A non-zero exit code that no signal caused is a failure;
     * every end is a deletion. A close main asked for ends by signal and is not one.
     */
    exited(sessionId: string, code: number | null | undefined, signal?: number | null): void {
      const entry = tracked.get(sessionId);
      if (!entry) return;
      tracked.delete(sessionId);
      exited.add(sessionId);
      if (exited.size > TOMBSTONES) exited.delete(exited.values().next().value as string);
      if (typeof code === 'number' && code !== 0 && !signal) enqueue(sessionId, entry, 'failed', `exited with code ${code}`);
      enqueue(sessionId, entry, 'deleted');
    },
    /** Stop delivering and drop everything held. */
    dispose(): void {
      disposed = true;
      queue.length = 0;
      tracked.clear();
      exited.clear();
    },
    pending: () => queue.length,
    trackedCount: () => tracked.size
  };
}

export type PtyLifecycleEmitter = ReturnType<typeof createPtyLifecycleEmitter>;
