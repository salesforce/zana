import { PEER_ID } from './peer-auth.js';

/** How long core waits for a plugin's `onConnectionRemoving` handler before removing the connection anyway. */
export const CONNECTION_REMOVING_TIMEOUT_MS = 5_000;
/** Longest status a plugin may attach to a connection, and how many connections one plugin may annotate. */
export const CONNECTION_STATUS_MAX = 200;
export const CONNECTION_STATUS_PER_PLUGIN_MAX = 64;
/** Most hidden orphan records kept; the oldest drops first. */
export const CONNECTION_ORPHAN_MAX = 256;

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

export type ConnectionRemovingHandler = (computerId: string) => void | Promise<void>;
export interface ConnectionRemovingFailure { pluginId: string; reason: 'timeout' | 'error' }

/**
 * Plugin-facing seam of the core connection store: who wants to hear about a connection going away, who listens for
 * changes, and the short per-plugin status text. Core never names a plugin; everything is keyed by the id the
 * registry handed the plugin. All state is in memory and dies with the plugin generation or the app.
 */
export class PeerConnectionRegistry {
  private readonly removing = new Map<string, ConnectionRemovingHandler>();
  private readonly listeners = new Set<() => void>();
  private readonly statuses = new Map<string, Map<string, string>>();
  private readonly failures = new Map<string, ConnectionRemovingFailure[]>();
  private readonly inflight = new Map<string, Promise<ConnectionRemovingFailure[]>>();
  private readonly orphans = new Map<string, { name: string; failed: ConnectionRemovingFailure[] }>();
  private disposed = false;

  /** One handler per plugin; returns the unsubscribe. */
  onRemoving(pluginId: string, handler: ConnectionRemovingHandler): () => void {
    if (typeof handler !== 'function') throw new Error('connection removing handler must be a function');
    if (this.removing.has(pluginId)) throw new Error('only one connection removing handler is allowed per plugin');
    this.removing.set(pluginId, handler);
    return () => { if (this.removing.get(pluginId) === handler) this.removing.delete(pluginId); };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Observers only: a throwing listener never disturbs the others or the caller. */
  notifyChanged(): void {
    if (this.disposed) return;
    for (const listener of [...this.listeners]) { try { listener(); } catch { /* observer only */ } }
  }

  /** Returns false when the input is not a valid status (nothing stored). `null` clears. */
  setStatus(pluginId: string, computerId: string, note: string | null): boolean {
    if (typeof computerId !== 'string' || !PEER_ID.test(computerId)) return false;
    if (note === null) { this.statuses.get(pluginId)?.delete(computerId); return true; }
    if (typeof note !== 'string' || CONTROL.test(note)) return false;
    const text = note.trim().slice(0, CONNECTION_STATUS_MAX);
    const own = this.statuses.get(pluginId) ?? new Map<string, string>();
    if (!own.has(computerId) && own.size >= CONNECTION_STATUS_PER_PLUGIN_MAX) return false;
    own.set(computerId, text);
    this.statuses.set(pluginId, own);
    return true;
  }

  statusOf(pluginId: string, computerId: string): string | undefined {
    return this.statuses.get(pluginId)?.get(computerId);
  }

  clearPlugin(pluginId: string): void {
    this.removing.delete(pluginId);
    this.statuses.delete(pluginId);
  }

  /** Failures recorded by the last removal run for this connection, for Retry / Remove anyway. */
  failuresFor(computerId: string): readonly ConnectionRemovingFailure[] {
    return this.failures.get(computerId) ?? [];
  }

  /**
   * Runs every plugin's handler in parallel, each raced against {@link CONNECTION_REMOVING_TIMEOUT_MS}. A failure
   * or timeout never vetoes: it is recorded and returned. Concurrent calls for the same connection share one run;
   * a later call (Retry) runs again and replaces the record.
   */
  runRemoving(computerId: string, timeoutMs = CONNECTION_REMOVING_TIMEOUT_MS): Promise<ConnectionRemovingFailure[]> {
    const running = this.inflight.get(computerId);
    if (running) return running;
    const run = (async () => {
      const failed: ConnectionRemovingFailure[] = [];
      await Promise.all([...this.removing].map(async ([pluginId, handler]) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([
            Promise.resolve().then(() => handler(computerId)).then(() => 'ok' as const, () => 'error' as const),
            new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), timeoutMs); timer.unref?.(); })
          ]);
          if (outcome !== 'ok') failed.push({ pluginId, reason: outcome });
        } finally { if (timer) clearTimeout(timer); }
      }));
      if (failed.length) this.failures.set(computerId, failed); else this.failures.delete(computerId);
      for (const own of this.statuses.values()) own.delete(computerId);
      return failed;
    })().finally(() => { this.inflight.delete(computerId); });
    this.inflight.set(computerId, run);
    return run;
  }

  /** The record of a connection that is gone for good (Remove anyway resolved it). */
  forget(computerId: string): void { this.failures.delete(computerId); }

  /**
   * Remove anyway: the connection went while these plugins' handlers had failed. Kept hidden (never shown in the
   * Peers list) so the plugin's leftover state for that computer can be found later and Forgotten.
   */
  recordOrphans(computerId: string, failed: readonly ConnectionRemovingFailure[], name = ''): void {
    if (!failed.length) return;
    this.orphans.delete(computerId);
    this.orphans.set(computerId, { name: name.slice(0, 80), failed: failed.map(failure => ({ ...failure })) });
    if (this.orphans.size > CONNECTION_ORPHAN_MAX) this.orphans.delete(this.orphans.keys().next().value!);
  }

  /** Computers removed while this plugin's handler had failed. */
  orphansOf(pluginId: string): string[] {
    return [...this.orphans].filter(([, record]) => record.failed.some(failure => failure.pluginId === pluginId)).map(([computerId]) => computerId);
  }

  /** Hidden orphan records, newest last; only computers whose plugin handler failed. */
  orphanRecords(): { computerId: string; name: string; failed: ConnectionRemovingFailure[] }[] {
    return [...this.orphans].slice(-64).map(([computerId, record]) => ({ computerId, name: record.name, failed: record.failed.map(failure => ({ ...failure })) }));
  }

  hasOrphan(computerId: string): boolean { return this.orphans.has(computerId); }

  /** Drops the hidden record (Forget). Returns whether one existed. */
  forgetOrphan(computerId: string): boolean {
    this.failures.delete(computerId);
    return this.orphans.delete(computerId);
  }

  dispose(): void {
    this.disposed = true;
    this.removing.clear();
    this.listeners.clear();
    this.statuses.clear();
    this.failures.clear();
    this.orphans.clear();
  }
}

/** Seam to the use-approval layer: which plugin may use which connection. */
export interface PeerConnectionUses {
  has(pluginId: string, computerId: string): boolean | Promise<boolean>;
  request(pluginId: string, computerId: string, signal: AbortSignal): Promise<'pending' | 'approved' | 'denied'>;
  /** Core-owned active-transfer confirmation for a plugin-originated Stop using. */
  confirmStop(pluginId: string, computerId: string, signal: AbortSignal): Promise<void>;
  stop(pluginId: string, computerId: string): Promise<void>;
}
