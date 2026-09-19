export type HarnessStatusMode = 'osc' | 'output-activity' | 'screen-scan' | 'sdk-events';

export type HarnessInteractionEvent =
  | { kind: 'requested'; key: string }
  | { kind: 'resolved'; keys: readonly string[] }
  | { kind: 'interrupted' };

export interface HarnessStatusAdapter {
  readonly mode: HarnessStatusMode;
  detectBlockedPrompt?(recentText: string): boolean;
  /** Normalize a native hook payload. Pending input outlives terminal repaints. */
  interactionHook?(body: string): HarnessInteractionEvent | null;
}
