import type { ApiErrorSessionRef } from '@zcc/harness-sdk';

/**
 * A failing-turn scenario for every adapter that reports API errors from a non-hook source.
 * The contract guard runs each one against the adapter's own producer.
 */
export interface ApiErrorFailureFixture {
  /** Point the producer's environment at a scratch store and write the session's file(s). */
  prepare(): { session: ApiErrorSessionRef; cleanup: () => void };
  /** Append a turn that ended on an API error. */
  appendFailedTurn(): void;
  /** Append a turn that ended normally. */
  appendSuccessfulTurn(): void;
}
