import type { ApiErrorProducer, ApiErrorSessionRef, HarnessInteractionEvent } from '@zcc/harness-sdk';
import { failedTurnFromRollout } from './failed-turn.js';
import { readRolloutTail, rolloutSize } from './rollout-reader.js';
import { CodexSessionResolver } from './session-resolver.js';

/** Codex posts no hook on a failed turn: look at its rollout once, a while after the turn went quiet. */
export const CODEX_QUIET_MS = 20_000;

interface TurnMarker {
  /** Rollout size at turn start; null when the rollout could not be found or opened then (first turn, file not yet written). */
  readonly offset: number | null;
}

export interface CodexApiErrorProducerDeps {
  resolver?: CodexSessionResolver;
  quietMs?: number;
}

export function createCodexApiErrorProducer(deps: CodexApiErrorProducerDeps = {}): ApiErrorProducer {
  const resolver = deps.resolver ?? new CodexSessionResolver();

  const resolve = (session: ApiErrorSessionRef) =>
    resolver.resolve(
      session.id,
      session.cwd,
      session.createdAt ?? 0,
      typeof session.codexSessionId === 'string' ? session.codexSessionId : undefined
    );

  return {
    quietMs: deps.quietMs ?? CODEX_QUIET_MS,
    async markTurnStart(session): Promise<TurnMarker> {
      // /resume and /new change which rollout a session writes to: look it up again every turn.
      resolver.forget(session.id);
      const match = await resolve(session);
      const offset = match ? await rolloutSize(match.rolloutPath, resolver.root) : null;
      return { offset };
    },
    async check(session, marker): Promise<HarnessInteractionEvent | null> {
      const turn = marker as TurnMarker | undefined;
      if (!turn) return null;
      const match = await resolve(session);
      if (!match) return null;
      const read = await readRolloutTail(match.rolloutPath, resolver.root, match.sessionId);
      if (!read) return null;
      // An unknown start is only safe when the whole rollout is a single turn.
      return turn.offset === null
        ? failedTurnFromRollout(read.tail, read.tailStartOffset, 0, { requireSingleTurn: true })
        : failedTurnFromRollout(read.tail, read.tailStartOffset, turn.offset);
    },
    release(sessionId) {
      resolver.forget(sessionId);
    }
  };
}
