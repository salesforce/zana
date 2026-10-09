import type { TurnTrace } from '../../../lib/studio-contract.js';

/** STUB (WS-6 owns): planner trace of one turn. */
export interface TracePanelProps {
  trace: TurnTrace | null;
  loading?: boolean;
  onRevealSource?(path: string, line: number): void;
}
export function TracePanel(_props: TracePanelProps) {
  return null;
}
