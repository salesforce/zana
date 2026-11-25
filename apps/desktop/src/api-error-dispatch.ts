/**
 * Neutral dispatch for `api-error-stop`. Hook harnesses reach it through their
 * `interactionHook`; harnesses with no failure hook reach it through a body-less
 * producer that is armed at turn start and asked once after a quiet period.
 * No vendor names here: producers come from the harness adapter.
 */

export interface ApiErrorStopEvent {
  kind: 'api-error-stop';
  error: string;
  text: string;
  retryable?: boolean;
}

/** Structural twin of the harness SDK `ApiErrorProducer` (desktop does not depend on the SDK package). */
export type ApiErrorSessionRef = { readonly id: string; readonly cwd: string; readonly createdAt?: number } & Readonly<Record<string, unknown>>;
export interface ApiErrorProducer {
  readonly quietMs: number;
  markTurnStart(session: ApiErrorSessionRef): Promise<unknown> | unknown;
  check(session: ApiErrorSessionRef, marker: unknown): Promise<{ kind: string } | null>;
  release(sessionId: string): void;
}

export interface DispatchCtx {
  /** False once the session has exited or no longer exists. */
  isLive(sessionId: string): boolean;
  /** Keep an open wrap-up turn open after a failed turn. */
  onTurnFailed(sessionId: string): void;
  /** Resume rules and Squad worker recovery. */
  route(sessionId: string, event: ApiErrorStopEvent): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  log(message: string, error?: unknown): void;
}

/** The one place an `api-error-stop` is handled, whichever producer found it. */
export function dispatchApiErrorStop(ctx: DispatchCtx, sessionId: string, event: ApiErrorStopEvent): void {
  ctx.onTurnFailed(sessionId);
  ctx.route(sessionId, event);
}

interface Armed {
  generation: number;
  producer: ApiErrorProducer;
  session: ApiErrorSessionRef;
  marker: unknown;
  timer: unknown;
  /** Quiet-period checks that found no finished turn yet. */
  rechecks: number;
}

/**
 * A turn can stay silent for longer than one quiet period (tool approval, a long silent tool).
 * A check that finds the turn unfinished is repeated, up to this many times, so a later failure is still seen.
 */
const MAX_RECHECKS = 12;

const generations = new Map<string, number>();
const armed = new Map<string, Armed>();
/** Sessions whose `markTurnStart` is still in flight. */
const pending = new Set<string>();

function nextGeneration(sessionId: string): number {
  const generation = (generations.get(sessionId) ?? 0) + 1;
  generations.set(sessionId, generation);
  return generation;
}

function clear(ctx: DispatchCtx, sessionId: string): void {
  const entry = armed.get(sessionId);
  if (entry?.timer !== undefined) ctx.clearTimer(entry.timer);
  armed.delete(sessionId);
}

function schedule(ctx: DispatchCtx, sessionId: string, entry: Armed): void {
  entry.timer = ctx.setTimer(() => {
    if (armed.get(sessionId) !== entry) return;
    armed.delete(sessionId);
    void runCheck(ctx, sessionId, entry).then((found) => {
      if (found || entry.rechecks >= MAX_RECHECKS) return;
      if (generations.get(sessionId) !== entry.generation || !ctx.isLive(sessionId) || armed.has(sessionId)) return;
      entry.rechecks += 1;
      armed.set(sessionId, entry);
      schedule(ctx, sessionId, entry);
    });
  }, entry.producer.quietMs);
  // Never keep the process alive for a diagnostic check.
  (entry.timer as { unref?: () => void } | undefined)?.unref?.();
}

/** True when a stop was found (or the check is moot); false means the turn has not failed yet. */
async function runCheck(ctx: DispatchCtx, sessionId: string, entry: Armed): Promise<boolean> {
  try {
    const event = await entry.producer.check(entry.session, entry.marker);
    if (generations.get(sessionId) !== entry.generation) return true;
    if (!ctx.isLive(sessionId)) return true;
    if (event?.kind === 'api-error-stop') {
      dispatchApiErrorStop(ctx, sessionId, event as ApiErrorStopEvent);
      return true;
    }
    return false;
  } catch (error) {
    ctx.log(`[api-error-dispatch] check failed session=${sessionId.slice(0, 8)}`, error);
    return true;
  }
}

/**
 * Turn start for a body-less producer: record the marker, then arm one quiet-period
 * check. A new turn replaces any earlier arm. Also the entry point for a producer that
 * has no `UserPromptSubmit` to mark resumed work.
 */
export function armQuietCheck(ctx: DispatchCtx, sessionId: string, producer: ApiErrorProducer, session: ApiErrorSessionRef): void {
  clear(ctx, sessionId);
  const generation = nextGeneration(sessionId);
  pending.add(sessionId);
  void (async () => {
    let marker: unknown;
    try {
      marker = await producer.markTurnStart(session);
    } catch (error) {
      ctx.log(`[api-error-dispatch] markTurnStart failed session=${sessionId.slice(0, 8)}`, error);
      if (generations.get(sessionId) === generation) pending.delete(sessionId);
      return;
    }
    if (generations.get(sessionId) === generation) pending.delete(sessionId);
    if (generations.get(sessionId) !== generation || !ctx.isLive(sessionId)) return;
    const entry: Armed = { generation, producer, session, marker, timer: undefined, rechecks: 0 };
    armed.set(sessionId, entry);
    schedule(ctx, sessionId, entry);
  })();
}

/** True while a check is pending for the session (including the marker being taken). */
export function isArmed(sessionId: string): boolean {
  return armed.has(sessionId) || pending.has(sessionId);
}

/** Output or a hook callback arrived: restart the quiet period of an armed check. */
export function touch(ctx: DispatchCtx, sessionId: string): void {
  const entry = armed.get(sessionId);
  if (!entry) return;
  if (entry.timer !== undefined) ctx.clearTimer(entry.timer);
  schedule(ctx, sessionId, entry);
}

/** Stop, Interrupt, new turn or exit: drop the timer and release producer state when `release` is set. */
export function disarm(ctx: DispatchCtx, sessionId: string, release?: ApiErrorProducer): void {
  nextGeneration(sessionId);
  pending.delete(sessionId);
  clear(ctx, sessionId);
  release?.release(sessionId);
}

/** Exit: disarm and forget the generation counter so nothing remains per session. */
export function forgetSession(ctx: DispatchCtx, sessionId: string, release?: ApiErrorProducer): void {
  disarm(ctx, sessionId, release);
  generations.delete(sessionId);
}

/** Test seam. */
export function armedCount(): number {
  return armed.size;
}

/**
 * Busy-edge arm trigger for harnesses with a body-less producer and no turn-start hook
 * (hook harnesses arm from their own callback). Skips exited sessions and ones already armed.
 */
export function armOnBusyEdge(
  ctx: DispatchCtx,
  sessionId: string,
  session: { readonly status: string } | null | undefined,
  status: { readonly apiErrorProducer?: ApiErrorProducer; readonly interactionHook?: unknown } | null | undefined,
  ref: () => ApiErrorSessionRef
): void {
  if (!session || session.status === 'exited') return;
  if (!status?.apiErrorProducer || status.interactionHook) return;
  if (isArmed(sessionId)) return;
  armQuietCheck(ctx, sessionId, status.apiErrorProducer, ref());
}
