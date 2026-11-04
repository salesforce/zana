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

export interface HarnessStatusAdapter {
  readonly mode: HarnessStatusMode;
  detectBlockedPrompt?(recentText: string): boolean;
  /** Normalize a native hook payload. Pending input outlives terminal repaints. */
  interactionHook?(body: string): HarnessInteractionEvent | null;
}
