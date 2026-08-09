/**
 * Host-managed live-stream relay (trusted core subsystem — the streaming twin of
 * {@link import('../zana/mcp-pool.js').McpPool}).
 *
 * A disk extension can only reach a subprocess/socket through the broker's
 * ONE-SHOT `ctx.exec`/`ctx.fetch` — neither holds a persistent connection. A live
 * push source (an SSE tail over a unix socket / HTTP) is a LONG-LIVED stream (one
 * request, then many server-pushed frames), so the child cannot own it. This relay
 * owns those connections in MAIN, on the extension's behalf, exposed through the
 * brokered `ctx.stream` capability (gated by the `stream` permission + the
 * `streamAllowlist` scope in `permission-broker.ts`; wired in `broker-caps.ts`).
 * Frames flow the OTHER direction (host → child push) over the process host's new
 * `stream-frame`/`stream-done` messages.
 *
 * Design constraints honored here (mirroring the MCP pool):
 *   - Rule 1/2 — the extension NEVER supplies a raw URL/socket. It names an opaque
 *     endpoint HANDLE; this relay resolves it, via the injected endpoint registry,
 *     to the real transport. An unknown/unresolvable handle degrades to a typed
 *     `StreamUnavailableError` — never a connection to an ext-chosen address.
 *   - Rule 3 — connections are long-lived emitters: the relay is constructed ONCE
 *     at app init and `disposeAll()` runs on the single shutdown path. Every
 *     subscription is registered in the map BEFORE the tail starts, and torn down
 *     (transport closed, sink listener released) on unsubscribe / terminal frame /
 *     sink-destroyed.
 *   - Rule 5 — bounded on every axis: at most {@link StreamRelayDeps.maxPerExtension}
 *     live subscriptions per extension AND {@link StreamRelayDeps.maxTotal} globally
 *     (a new subscribe past either cap is rejected), each frame is size-capped
 *     ({@link StreamRelayDeps.maxFrameBytes}) and drop-on-exceed, each subscription
 *     is frame-RATE-capped ({@link StreamRelayDeps.maxFramesPerSec}) so a chatty/
 *     hostile source can't flood the child, and an idle subscription (no frames for
 *     {@link StreamRelayDeps.idleTtlMs}) is torn down.
 *   - Degrade gracefully — resolve-fail / transport-open-fail / a frame that fails
 *     validation all handled WITHOUT throwing out of `subscribe()`; an invalid frame
 *     is dropped + logged, a transport error emits a terminal `done` with the reason.
 *
 * This file is Electron-free and dependency-injected (transport opener + clock +
 * id mint + endpoint registry) so it is unit-testable with a fake transport, no
 * real socket required. The production SSE-over-http transport lives at the bottom
 * ({@link openSseTransport}).
 */

import * as http from 'node:http';

/** How an endpoint handle resolves to a concrete transport target. */
export interface StreamEndpointDef {
  /** Stable handle an extension names in `streamAllowlist` / `ctx.stream(handle)`. */
  id: string;
  /**
   * Resolve the concrete transport target for this handle, or null if it isn't
   * available (e.g. the backing socket doesn't exist yet). Called lazily on each
   * subscribe so a PATH/socket that appears later still connects. The returned
   * target is CORE-OWNED — the extension never sees or supplies it (Rule 1/2).
   *
   * `opts` carries the extension's per-subscribe HINTS (verbatim from
   * `ctx.stream(handle, opts)`) — e.g. a session id a per-session endpoint needs
   * to build its path. It is UNTRUSTED renderer/agent input: the resolver MUST
   * validate/confine anything it reads (Rule 1/2) and return null on a bad hint
   * rather than trusting it into a path. Endpoints with no per-subscribe input
   * ignore the arg (backward-compatible — the parameter is optional).
   */
  resolveTarget: (opts?: Record<string, unknown>) => StreamTarget | null;
  /** Human label for logs / unavailable messages. */
  label: string;
}

/** A resolved, core-owned SSE transport target (unix socket OR host:port + path). */
export interface StreamTarget {
  /** Unix domain socket path (mutually exclusive with host/port). */
  socketPath?: string;
  /** TCP host (mutually exclusive with socketPath). */
  host?: string;
  /** TCP port. */
  port?: number;
  /** Request path (e.g. `/sessions/abc/events`). */
  path: string;
}

/** Thrown (message surfaced to the ext) when an endpoint can't be reached at all. */
export class StreamUnavailableError extends Error {
  constructor(endpoint: string, detail: string) {
    super(`Stream endpoint "${endpoint}" unavailable: ${detail}`);
    this.name = 'StreamUnavailableError';
  }
}

/** Terminal reason handed to the child's `onDone`. */
export type StreamDoneReason =
  | { ok: true }
  | { ok: false; error: string };

/**
 * A live transport the relay drives. `close()` MUST be idempotent and stop all
 * further `onFrame`/`onDone` calls. The production impl is {@link openSseTransport}.
 */
export interface StreamTransport {
  close(): void;
}

/** Opens a transport for a resolved target, wiring the frame/done sinks. */
export type StreamTransportOpener = (
  target: StreamTarget,
  onFrame: (raw: string) => void,
  onDone: (reason: StreamDoneReason) => void
) => StreamTransport;

/** Where a validated frame is delivered (the host→child push side). */
export interface StreamSink {
  /** Push one validated frame to the child, keyed by subscription id. */
  frame(subId: string, frame: unknown): void;
  /** Push the terminal signal; the relay closes the subscription right after. */
  done(subId: string, reason: StreamDoneReason): void;
}

export interface StreamRelayDeps {
  /** Endpoint registry (handle → transport-target resolver). */
  endpoints: StreamEndpointDef[];
  /** Delivers validated frames / terminal signals to the child (host→child push). */
  sink: StreamSink;
  /** Structured logger (tagged host-side). */
  log: (message: string, err?: unknown) => void;
  /** Injected transport opener (production: {@link openSseTransport}); mockable. */
  open?: StreamTransportOpener;
  /** Opaque subscription-id mint. Default: a monotonic counter (`sub-N`). */
  makeId?: () => string;
  /** Monotonic clock (ms). Injectable so tests control idle/rate windows. Default Date.now. */
  now?: () => number;
  /** Max live subscriptions per extension id. Default 8. */
  maxPerExtension?: number;
  /** Max live subscriptions across ALL extensions. Default 32. */
  maxTotal?: number;
  /** Max bytes in a single serialized frame; a larger frame is dropped. Default 128 KiB. */
  maxFrameBytes?: number;
  /** Max frames/sec per subscription; excess frames are dropped (not queued). Default 50. */
  maxFramesPerSec?: number;
  /** Idle TTL (ms): a subscription with no delivered frames this long is torn down. Default 5 min. */
  idleTtlMs?: number;
}

interface Subscription {
  subId: string;
  moduleId: string;
  endpoint: string;
  transport: StreamTransport;
  /** Frames delivered in the current 1s rate window + when it started. */
  windowStart: number;
  windowCount: number;
  lastFrameAt: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  closed: boolean;
}

/** Defaults kept as named constants so tests + docs reference the same bounds. */
export const STREAM_MAX_PER_EXTENSION = 8;
export const STREAM_MAX_TOTAL = 32;
export const STREAM_MAX_FRAME_BYTES = 128 * 1024;
export const STREAM_MAX_FRAMES_PER_SEC = 50;
export const STREAM_IDLE_TTL_MS = 5 * 60_000;

export class StreamRelay {
  private readonly endpoints = new Map<string, StreamEndpointDef>();
  private readonly subs = new Map<string, Subscription>();
  private readonly openFn: StreamTransportOpener;
  private readonly makeId: () => string;
  private readonly now: () => number;
  private readonly maxPerExtension: number;
  private readonly maxTotal: number;
  private readonly maxFrameBytes: number;
  private readonly maxFramesPerSec: number;
  private readonly idleTtlMs: number;
  private idCounter = 0;
  private disposed = false;

  constructor(private readonly deps: StreamRelayDeps) {
    for (const e of deps.endpoints) this.endpoints.set(e.id, e);
    this.openFn = deps.open ?? openSseTransport;
    this.makeId = deps.makeId ?? (() => `sub-${++this.idCounter}`);
    this.now = deps.now ?? (() => Date.now());
    this.maxPerExtension = deps.maxPerExtension ?? STREAM_MAX_PER_EXTENSION;
    this.maxTotal = deps.maxTotal ?? STREAM_MAX_TOTAL;
    this.maxFrameBytes = deps.maxFrameBytes ?? STREAM_MAX_FRAME_BYTES;
    this.maxFramesPerSec = deps.maxFramesPerSec ?? STREAM_MAX_FRAMES_PER_SEC;
    this.idleTtlMs = deps.idleTtlMs ?? STREAM_IDLE_TTL_MS;
  }

  /**
   * Open a subscription to `endpoint`'s resolved transport for `moduleId`, pushing
   * validated frames to the sink keyed by the returned opaque subscription id.
   *
   * Throws {@link StreamUnavailableError} SYNCHRONOUSLY for a bad handle / capacity
   * / resolve-fail (so the child's `await ctx.stream` rejects). A transport error
   * AFTER open is delivered as a terminal `done({ok:false})`, not a throw.
   */
  subscribe(
    moduleId: string,
    endpoint: string,
    opts?: Record<string, unknown>
  ): string {
    if (this.disposed) throw new StreamUnavailableError(endpoint, 'relay disposed');
    const def = this.endpoints.get(endpoint);
    if (!def) throw new StreamUnavailableError(endpoint, 'unknown endpoint handle');

    // Rule 5: bound total + per-extension BEFORE opening anything.
    if (this.subs.size >= this.maxTotal) {
      throw new StreamUnavailableError(endpoint, `global subscription cap reached (${this.maxTotal})`);
    }
    let perExt = 0;
    for (const s of this.subs.values()) if (s.moduleId === moduleId) perExt++;
    if (perExt >= this.maxPerExtension) {
      throw new StreamUnavailableError(
        endpoint,
        `per-extension subscription cap reached (${this.maxPerExtension})`
      );
    }

    // Rule 1/2: the CORE registry resolves the concrete transport target; the
    // extension never supplies or sees a raw URL/socket.
    let target: StreamTarget | null;
    try {
      target = def.resolveTarget(opts);
    } catch (err) {
      throw new StreamUnavailableError(endpoint, `resolve failed (${errMsg(err)})`);
    }
    if (!target) throw new StreamUnavailableError(endpoint, `${def.label} not available`);

    const subId = this.makeId();
    const nowMs = this.now();
    const sub: Subscription = {
      subId,
      moduleId,
      endpoint,
      // Placeholder replaced synchronously below; keeps the field non-null.
      transport: { close() {} },
      windowStart: nowMs,
      windowCount: 0,
      lastFrameAt: nowMs,
      closed: false
    };
    // Register BEFORE opening the tail so an immediate frame/error finds the sub.
    this.subs.set(subId, sub);

    const onFrame = (raw: string) => this.relay(sub, raw);
    const onDone = (reason: StreamDoneReason) => {
      if (sub.closed) return;
      this.deps.sink.done(subId, reason);
      this.close(subId);
    };

    let transport: StreamTransport;
    try {
      transport = this.openFn(target, onFrame, onDone);
    } catch (err) {
      this.subs.delete(subId);
      throw new StreamUnavailableError(endpoint, `open failed (${errMsg(err)})`);
    }
    sub.transport = transport;
    this.armIdle(sub);
    return subId;
  }

  /**
   * Close a subscription ON BEHALF of `moduleId` — the broker `stream.close` path.
   * Ownership-checked: an extension can only close a subId it OWNS (a forged/other
   * id is a silent no-op), so one ext can't tear down another's stream. Idempotent.
   */
  unsubscribe(moduleId: string, subId: string): void {
    const sub = this.subs.get(subId);
    if (!sub || sub.moduleId !== moduleId) return;
    this.close(subId);
  }

  /** Close ONE subscription (unsubscribe / terminal / sink-destroyed). Idempotent. */
  close(subId: string): void {
    const sub = this.subs.get(subId);
    if (!sub) return;
    sub.closed = true;
    if (sub.idleTimer) clearTimeout(sub.idleTimer);
    try {
      sub.transport.close();
    } catch (err) {
      this.deps.log(`stream ${sub.endpoint}: transport close failed`, err);
    }
    this.subs.delete(subId);
  }

  /** Close every subscription owned by `moduleId` (child teardown / crash — Rule 3). */
  closeForModule(moduleId: string): void {
    for (const sub of [...this.subs.values()]) {
      if (sub.moduleId === moduleId) this.close(sub.subId);
    }
  }

  /** Tear down every subscription (app quit). Idempotent; safe on the shutdown path. */
  disposeAll(): void {
    this.disposed = true;
    for (const sub of [...this.subs.values()]) this.close(sub.subId);
  }

  /** Live subscription count — for diagnostics/tests. */
  size(): number {
    return this.subs.size;
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Validate + rate-cap + size-cap ONE raw frame, then deliver it to the sink.
   * A malformed / oversized / over-rate frame is DROPPED (logged, never surfaced
   * to the child as a bad frame) — the relay can only ever drop, never forge.
   */
  private relay(sub: Subscription, raw: string): void {
    if (sub.closed) return;

    // Size cap (Rule 5): drop an oversized frame before parsing it.
    if (raw.length > this.maxFrameBytes) {
      this.deps.log(
        `stream ${sub.endpoint}: dropped frame exceeding ${this.maxFrameBytes} bytes`
      );
      return;
    }

    // Rate cap (Rule 5): a chatty/hostile source can't flood the child. Frames
    // past the per-second budget are DROPPED (not queued — queueing would let a
    // burst defer unbounded memory to the child).
    const nowMs = this.now();
    if (nowMs - sub.windowStart >= 1000) {
      sub.windowStart = nowMs;
      sub.windowCount = 0;
    }
    if (sub.windowCount >= this.maxFramesPerSec) {
      // Log once per window (on the first drop) to avoid log flooding.
      if (sub.windowCount === this.maxFramesPerSec) {
        this.deps.log(
          `stream ${sub.endpoint}: rate cap ${this.maxFramesPerSec}/s exceeded — dropping frames`
        );
      }
      sub.windowCount++;
      return;
    }
    sub.windowCount++;

    // Structural validation: the frame must be valid JSON parsing to an object.
    // A non-JSON keep-alive / heartbeat line, or a non-object payload, is dropped.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Non-JSON comment/heartbeat — silently ignore (don't count as a bad frame).
      return;
    }
    if (parsed === null || typeof parsed !== 'object') {
      this.deps.log(`stream ${sub.endpoint}: dropped non-object frame`);
      return;
    }

    sub.lastFrameAt = nowMs;
    this.armIdle(sub);
    this.deps.sink.frame(sub.subId, parsed);
  }

  private armIdle(sub: Subscription): void {
    if (sub.idleTimer) clearTimeout(sub.idleTimer);
    sub.idleTimer = setTimeout(() => {
      this.deps.sink.done(sub.subId, { ok: false, error: 'idle timeout' });
      this.close(sub.subId);
    }, this.idleTtlMs);
    // Don't keep the process alive just for an idle-reaper timer.
    (sub.idleTimer as { unref?: () => void }).unref?.();
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Split an accumulated SSE buffer into complete events, calling `onEvent` with the
 * joined `data:` payload of each, and return the unconsumed remainder. The whole
 * buffer is CRLF-normalized (a `\r\n` boundary can straddle two chunks), then split
 * on the blank-line event separator. Comment/heartbeat lines (no `data:`) yield an
 * empty payload and are skipped.
 */
export function drainSseFrames(buffer: string, onEvent: (payload: string) => void): string {
  let rest = buffer.replace(/\r\n/g, '\n');
  let sep = rest.indexOf('\n\n');
  while (sep !== -1) {
    const rawEvent = rest.slice(0, sep);
    const dataLines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());
    if (dataLines.length > 0) onEvent(dataLines.join('\n'));
    rest = rest.slice(sep + 2);
    sep = rest.indexOf('\n\n');
  }
  return rest;
}

/**
 * Production transport: tail an SSE endpoint over a unix socket / TCP host, driving
 * `onFrame` with each event's `data:` payload and `onDone` on end/error. Uses raw
 * `http.request` (no fetch — SSE is a persistent server-push stream, not a bounded
 * body). `close()` marks settled + destroys the request so the resulting error
 * callback doesn't emit a spurious terminal frame (the unsubscribe owns that).
 */
export function openSseTransport(
  target: StreamTarget,
  onFrame: (raw: string) => void,
  onDone: (reason: StreamDoneReason) => void
): StreamTransport {
  let settled = false;
  const finish = (reason: StreamDoneReason): void => {
    if (settled) return;
    settled = true;
    onDone(reason);
  };

  const options: http.RequestOptions = target.socketPath
    ? { socketPath: target.socketPath, path: target.path, method: 'GET' }
    : { host: target.host, port: target.port, path: target.path, method: 'GET' };
  options.headers = { host: 'localhost', accept: 'text/event-stream' };

  const request = http.request(options, (res) => {
    if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
      res.resume();
      finish({ ok: false, error: `HTTP ${res.statusCode}` });
      return;
    }
    res.setEncoding('utf8');
    let buffer = '';
    res.on('data', (chunk: string) => {
      buffer = drainSseFrames(buffer + chunk, onFrame);
    });
    res.on('end', () => finish({ ok: true }));
    res.on('error', (err) => finish({ ok: false, error: errMsg(err) }));
  });
  request.on('error', (err) => finish({ ok: false, error: errMsg(err) }));
  request.end();

  return {
    close(): void {
      settled = true;
      try {
        request.destroy();
      } catch {
        /* already destroyed */
      }
    }
  };
}
