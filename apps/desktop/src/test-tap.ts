/**
 * Gated test-observability tap (E2E only).
 *
 * WHY THIS EXISTS: e2e specs need to assert on the ORDERED live event/log
 * timeline the app produces at runtime (harness/agent lifecycle transitions,
 * inbox pushes, …), not just poll after-the-fact snapshots.
 * The one main→renderer fan-out is `safeSend(channel, ...args)` in
 * `apps/desktop/src/host.ts`; every push routes through it, so recording there captures
 * the whole event stream from a SINGLE tap point — including events emitted
 * before the renderer subscribes, and across a renderer reload (the buffer lives
 * here in main, so a reload can't clear it). Main-side logs (`logMainError` and,
 * once enabled, `console.*`) land in the same ordered ring.
 *
 * INERT IN PRODUCTION (Rule 3 / Rule 5): nothing here does anything until
 * `enable()` is called, which happens ONLY when `process.env.ZCC_E2E` is set at
 * boot (see `index.ts`). Until then the exported `record`/`recordLog` bindings
 * are shared no-op functions — the off-state cost on the `safeSend` hot path is
 * one call into an empty function, with NO allocation and NO array push, so it
 * cannot measurably change production timing. The ring is bounded
 * (`TAP_RING_CAP`) per Rule 5. This module is intentionally self-contained (it
 * imports nothing from `index.ts`) to avoid an import cycle.
 *
 * Mirrors the ring + monotonic-`seq` + cursor-drain idiom already used by
 * `AgentStatusTracker` (`agent-status.ts`), so the team reasons about it the
 * same way (`agentStatusSince` ≈ `drain`).
 */

/** Bounded ring cap (Rule 5). Shared by events + logs; test-only load. */
export const TAP_RING_CAP = 2000;

export type TapEntryKind = 'event' | 'log';

export interface TapEntry {
  /** Monotonic, main-owned, never reused — a stable cursor across resets. */
  seq: number;
  /** Wall-clock capture time. */
  ts: number;
  kind: TapEntryKind;
  /** For 'event': the IPC channel. For 'log': `log:<level>`. */
  channel: string;
  /** For 'event': the `safeSend` args. For 'log': `[context, message]`. */
  args: unknown[];
}

export interface TapSnapshot {
  seq: number;
  size: number;
  cap: number;
}

export interface TapDrain {
  entries: TapEntry[];
  cursor: number;
}

let enabled = false;
let seq = 0;
const ring: TapEntry[] = [];

// Preserve the original console methods so the shim (installed only in enable())
// still writes to the real stdout/stderr after recording.
type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';
const CONSOLE_METHODS: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'];
const originalConsole: Partial<Record<ConsoleMethod, (...a: unknown[]) => void>> = {};

/**
 * Copy args into a structured-clone-safe shape. The tap must NEVER throw into
 * `safeSend` (a broken push would break the app), and `drainEvents` must be able
 * to cross the contextBridge — so anything unserializable degrades to a
 * `String(arg)` placeholder rather than propagating an error.
 */
function safeClone(args: unknown[]): unknown[] {
  return args.map((arg) => {
    try {
      return JSON.parse(JSON.stringify(arg));
    } catch {
      try {
        return String(arg);
      } catch {
        return '[unserializable]';
      }
    }
  });
}

function push(kind: TapEntryKind, channel: string, args: unknown[]): void {
  seq += 1;
  ring.push({ seq, ts: Date.now(), kind, channel, args: safeClone(args) });
  // Evict oldest past the cap. O(n) shift, but only under the flag (test load).
  if (ring.length > TAP_RING_CAP) ring.shift();
}

// --- The hot-path recorders. Swapped from NOOP to active in enable(), so the
// off state is genuinely allocation-free (and the swap is observable in tests).
const NOOP_RECORD = (_channel: string, _args: unknown[]): void => {};
const NOOP_LOG = (_level: string, _context: string, _message: string): void => {};

/** Record a main→renderer event. Bound to a no-op until `enable()`. */
export let record: (channel: string, args: unknown[]) => void = NOOP_RECORD;
/** Record a main-side log line. Bound to a no-op until `enable()`. */
export let recordLog: (level: string, context: string, message: string) => void = NOOP_LOG;

/** True once `enable()` has run (i.e. `ZCC_E2E` was set at boot). */
export function isEnabled(): boolean {
  return enabled;
}

/**
 * Arm the tap. Idempotent. Called once at boot from `index.ts` ONLY when
 * `ZCC_E2E` is set — BEFORE `registerIpc()`/`wireBridgeListeners()` so the very
 * first push/log is captured.
 */
export function enable(): void {
  if (enabled) return;
  enabled = true;
  record = (channel, args) => push('event', channel, args);
  recordLog = (level, context, message) => push('log', `log:${level}`, [context, message]);
  installConsoleShim();
}

/** Wrap console.* to record then delegate. Flag-on only — prod console untouched. */
function installConsoleShim(): void {
  for (const method of CONSOLE_METHODS) {
    if (originalConsole[method]) continue; // already shimmed
    const original = console[method].bind(console) as (...a: unknown[]) => void;
    originalConsole[method] = original;
    console[method] = (...a: unknown[]) => {
      try {
        push('log', `log:${method}`, a);
      } catch {
        /* recording must never break logging */
      }
      original(...a);
    };
  }
}

/**
 * Return entries after `cursor` (a prior `seq`), plus the new cursor. A
 * `cursor <= 0` returns the whole ring. Mirrors `agentStatusSince` semantics.
 */
export function drain(cursor: number): TapDrain {
  const entries = cursor <= 0 ? ring.slice() : ring.filter((e) => e.seq > cursor);
  return { entries, cursor: seq };
}

export function snapshot(): TapSnapshot {
  return { seq, size: ring.length, cap: TAP_RING_CAP };
}

/**
 * Clear the ring. `seq` is deliberately NOT reset, so cursors stay globally
 * monotonic — a recorder that reset mid-run can re-read `snapshot().seq` and
 * never collide with a stale cursor.
 */
export function reset(): void {
  ring.length = 0;
}
