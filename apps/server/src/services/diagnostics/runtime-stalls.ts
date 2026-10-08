import { PerformanceObserver, type PerformanceEntry } from 'node:perf_hooks';

/**
 * Event-loop stall + slow-operation diagnostics for the server runtime.
 *
 * The server runs HTTP handlers, synchronous SQLite and in-process plugins on
 * one thread, so a single slow operation freezes every request. This module
 * records which operations overlapped a stall so `server.log` names the
 * culprit instead of just reporting that the UI timed out.
 */

export interface RuntimeDiagnosticsOptions {
  /** Report a stall when the heartbeat is late by at least this much. */
  stallThresholdMs?: number;
  /** Report an operation that takes at least this long, end to end. */
  slowOperationMs?: number;
  /** Report a garbage-collection pause at least this long. */
  slowGcMs?: number;
  sampleIntervalMs?: number;
  /** At most this many warnings per window; the rest are counted, not logged. */
  maxWarningsPerWindow?: number;
  warningWindowMs?: number;
  warn?: (message: string) => void;
  now?: () => number;
  observeGc?: boolean;
}

export interface RuntimeDiagnostics {
  start(): void;
  stop(): void;
  /** Begin tracking an operation. Call the returned function exactly once when it ends. */
  track(label: string): () => void;
  /** Exposed for tests: run one heartbeat check now. */
  checkNow(): void;
}

interface Operation { label: string; startedAt: number; endedAt?: number }

const RECENT_LIMIT = 32;
const REPORTED_OPERATIONS = 6;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_SEGMENT = /^(?=.*\d)[A-Za-z0-9_-]{16,}$/;

/** Path without query string, with ids collapsed so logs stay short and free of user data. */
export function diagnosticRouteLabel(method: string | undefined, rawUrl: string | undefined): string {
  const path = (rawUrl ?? '/').split('?')[0]!.split('#')[0]!;
  const segments = path.split('/').map((segment) =>
    UUID_SEGMENT.test(segment) || OPAQUE_SEGMENT.test(segment) ? ':id' : segment.slice(0, 64));
  return `${(method ?? 'GET').toUpperCase()} ${segments.join('/').slice(0, 160)}`;
}

/** Label a parentPort runtime message without reading its payload. */
export function diagnosticRuntimeLabel(data: unknown): string {
  if (!data || typeof data !== 'object') return 'runtime:invalid';
  const message = data as { type?: unknown; operation?: unknown; pluginId?: unknown; method?: unknown };
  const type = typeof message.type === 'string' ? message.type.slice(0, 32) : 'invalid';
  if (type !== 'request' || typeof message.operation !== 'string') return `runtime:${type}`;
  const operation = message.operation.slice(0, 48);
  if (operation === 'plugins-call-rpc' && typeof message.pluginId === 'string' && typeof message.method === 'string') {
    return `runtime:${operation} ${message.pluginId.slice(0, 64)}.${message.method.slice(0, 64)}`;
  }
  return `runtime:${operation}`;
}

export function createRuntimeDiagnostics(options: RuntimeDiagnosticsOptions = {}): RuntimeDiagnostics {
  const stallThresholdMs = options.stallThresholdMs ?? 1_000;
  const slowOperationMs = options.slowOperationMs ?? 2_000;
  const slowGcMs = options.slowGcMs ?? 500;
  const sampleIntervalMs = options.sampleIntervalMs ?? 250;
  const maxWarnings = options.maxWarningsPerWindow ?? 30;
  const windowMs = options.warningWindowMs ?? 60_000;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const now = options.now ?? (() => performance.now());
  const observeGc = options.observeGc ?? true;

  const inflight = new Set<Operation>();
  const recent: Operation[] = [];
  let timer: NodeJS.Timeout | null = null;
  let gcObserver: PerformanceObserver | null = null;
  let lastTick = 0;
  let windowStart = 0;
  let warnings = 0;
  let suppressed = 0;

  const emit = (message: string) => {
    const at = now();
    if (at - windowStart >= windowMs) {
      if (suppressed > 0) warn(`[diagnostics] suppressed ${suppressed} warnings in the last ${Math.round(windowMs / 1000)}s`);
      windowStart = at;
      warnings = 0;
      suppressed = 0;
    }
    if (warnings >= maxWarnings) { suppressed++; return; }
    warnings++;
    warn(message);
  };

  const describe = (from: number, to: number): string => {
    const overlapping = [...inflight, ...recent]
      .filter((op) => op.startedAt <= to && (op.endedAt ?? to) >= from)
      .map((op) => ({ op, duration: (op.endedAt ?? to) - op.startedAt }))
      .sort((a, b) => b.duration - a.duration);
    if (overlapping.length === 0) return 'no tracked operation';
    const shown = overlapping.slice(0, REPORTED_OPERATIONS).map(({ op, duration }) =>
      `${op.label} (${Math.round(duration)}ms${op.endedAt === undefined ? ', running' : ''})`);
    const more = overlapping.length - shown.length;
    return shown.join(', ') + (more > 0 ? ` +${more} more` : '');
  };

  const checkNow = () => {
    const at = now();
    const lag = at - lastTick - sampleIntervalMs;
    if (lastTick > 0 && lag >= stallThresholdMs) {
      emit(`[diagnostics] event loop stalled ${Math.round(lag)}ms; overlapping: ${describe(lastTick, at)}`);
    }
    lastTick = at;
  };

  const onGc = (entries: { getEntries(): PerformanceEntry[] }) => {
    for (const entry of entries.getEntries()) {
      if (entry.duration >= slowGcMs) emit(`[diagnostics] garbage collection paused ${Math.round(entry.duration)}ms`);
    }
  };

  return {
    start() {
      if (timer) return;
      lastTick = now();
      timer = setInterval(checkNow, sampleIntervalMs);
      timer.unref?.();
      if (observeGc) {
        try {
          gcObserver = new PerformanceObserver(onGc);
          gcObserver.observe({ entryTypes: ['gc'] });
        } catch {
          gcObserver = null; // gc entries are unavailable in some runtimes; stalls still report.
        }
      }
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      gcObserver?.disconnect();
      gcObserver = null;
      inflight.clear();
      recent.length = 0;
    },
    track(label) {
      const op: Operation = { label, startedAt: now() };
      inflight.add(op);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        op.endedAt = now();
        inflight.delete(op);
        recent.push(op);
        if (recent.length > RECENT_LIMIT) recent.shift();
        const duration = op.endedAt - op.startedAt;
        if (duration >= slowOperationMs) emit(`[diagnostics] slow ${label} took ${Math.round(duration)}ms`);
      };
    },
    checkNow
  };
}
