export type HarnessStatusMode = 'osc' | 'output-activity' | 'screen-scan' | 'sdk-events';

export type HarnessInteractionEvent =
  | { kind: 'requested'; key: string }
  | { kind: 'resolved'; keys: readonly string[] }
  | { kind: 'interrupted' }
  /** A turn ended on an API error; error is the harness's error type, text the bounded error text. */
  | {
      kind: 'api-error-stop'; error: string; text: string;
      /** True when the harness judged the error temporary; absent means unknown and is treated as temporary by the Squad engine. */
      retryable?: boolean;
    };

/** How a harness reports that a turn stopped on an API error ('none' = it cannot yet). */
export type HarnessApiErrorSignal = 'hook' | 'sdk-events' | 'screen-scan' | 'none';

/**
 * Shared API-error vocabulary. Each harness maps its own errors into these kinds.
 * These are the only retryable kinds: any other kind, including one a harness does not recognise, is not retried.
 */
export const API_ERROR_RETRYABLE_KINDS = ['rate_limit', 'overloaded', 'server_error', 'unknown'] as const;

const RETRYABLE_KINDS: ReadonlySet<string> = new Set(API_ERROR_RETRYABLE_KINDS);

/** True only for the kinds in `API_ERROR_RETRYABLE_KINDS`; every harness uses this one rule. */
export function isRetryableApiErrorKind(kind: string): boolean {
  return RETRYABLE_KINDS.has(kind);
}

/** What the host knows about a session when it asks a producer to look. Harness-specific fields ride along untyped. */
export type ApiErrorSessionRef = {
  readonly id: string;
  readonly cwd: string;
  readonly createdAt?: number;
} & Readonly<Record<string, unknown>>;

/**
 * A producer of `api-error-stop` for a harness that has no failure hook and posts no body.
 * The host arms it at turn start and, after a quiet period, asks it once whether the turn failed.
 */
export interface ApiErrorProducer {
  /** Milliseconds with no hook callback and no PTY output before the one check. */
  readonly quietMs: number;
  /** Record where this turn begins (an opaque marker); called at turn start. */
  markTurnStart(session: ApiErrorSessionRef): Promise<unknown> | unknown;
  /** Inspect the turn that began at `marker`; null when it did not end on an API error. */
  check(session: ApiErrorSessionRef, marker: unknown): Promise<HarnessInteractionEvent | null>;
  /** Release any per-session state. */
  release(sessionId: string): void;
}

export interface HarnessStatusAdapter {
  readonly mode: HarnessStatusMode;
  /** Explicit declaration of how this harness reports API-error stops. */
  readonly apiErrorSignal: HarnessApiErrorSignal;
  detectBlockedPrompt?(recentText: string): boolean;
  /** Normalize a native hook payload. Pending input outlives terminal repaints. */
  interactionHook?(body: string): HarnessInteractionEvent | null;
  /** Body-less producer for harnesses with no failure hook; see `ApiErrorProducer`. */
  readonly apiErrorProducer?: ApiErrorProducer;
}
