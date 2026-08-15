export type HarnessStatusMode = 'osc' | 'output-activity' | 'screen-scan' | 'sdk-events';

export interface HarnessStatusAdapter {
  readonly mode: HarnessStatusMode;
  detectBlockedPrompt?(recentText: string): boolean;
}
