import type { AgentRuntime } from '@zana-ai/zcc-agent-runtime';
import { HostCommandError } from './host-command-error.js';

/** How long a steer waits for a starting turn before giving up. */
export const SUBMITTED_TURN_ACTIVE_TURN_WAIT_MS = 5_000;
const STEER_ATTEMPTS = 2;

type DeliveryRuntime = Pick<AgentRuntime, 'runTurn' | 'steerTurn' | 'getActiveTurnId' | 'getLiveThreadIds' | 'waitForActiveTurn'>;
type TurnPayload = Parameters<AgentRuntime['runTurn']>[0];

/**
 * Deliver a follow-up as a steer when a turn is live, else as a new turn.
 * A steer whose turn ended before it landed is retargeted at the live turn,
 * or started as a new turn when the thread went idle, never dropped.
 */
export async function deliverSubmittedTurn(
  runtime: DeliveryRuntime,
  payload: TurnPayload,
  args: { mode?: string; expectedTurnId?: string | null; activeTurnWaitMs?: number }
): Promise<'steered' | 'started'> {
  const explicitSteer = args.mode === 'steer' || args.mode === 'steer-if-active';
  const autoMode = args.mode == null || args.mode === 'auto';
  let target = args.expectedTurnId ?? runtime.getActiveTurnId(payload.threadId) ?? null;
  if (!target && explicitSteer) {
    // Steering right after a send: the turn is still starting. Wait for it
    // rather than racing a competing turn.
    target = await resolveLiveTurn(runtime, payload.threadId, args.activeTurnWaitMs);
  }
  if (!target || (!explicitSteer && !autoMode)) {
    await runtime.runTurn(payload);
    return 'started';
  }
  let activeTurnId: string | null = null;
  for (let attempt = 0; attempt < STEER_ATTEMPTS; attempt += 1) {
    const result = await runtime.steerTurn({ ...payload, expectedTurnId: target });
    if (result?.status !== 'stale') return 'steered';
    activeTurnId = result.activeTurnId;
    if (attempt === STEER_ATTEMPTS - 1) break;
    const live = await resolveLiveTurn(runtime, payload.threadId, args.activeTurnWaitMs);
    if (live === null) {
      await runtime.runTurn(payload);
      return 'started';
    }
    if (live === target) break;
    target = live;
  }
  throw new HostCommandError(
    'stale_turn',
    `Expected active turn ${target} for thread ${payload.threadId}, but active turn is ${activeTurnId ?? 'none'}`
  );
}

async function resolveLiveTurn(runtime: DeliveryRuntime, threadId: string, waitMs = SUBMITTED_TURN_ACTIVE_TURN_WAIT_MS): Promise<string | null> {
  const active = runtime.getActiveTurnId(threadId);
  if (active) return active;
  if (!runtime.getLiveThreadIds().includes(threadId)) return null;
  const awaited = await runtime.waitForActiveTurn(threadId, { timeoutMs: waitMs });
  if (awaited) return awaited;
  const refreshed = runtime.getActiveTurnId(threadId);
  if (refreshed) return refreshed;
  if (runtime.getLiveThreadIds().includes(threadId)) {
    throw new HostCommandError('competing_turn', `Refusing to start a competing turn while ${threadId} is still starting`);
  }
  return null;
}
