import type { StudioViewState } from '../../../lib/studio-contract.js';

/** STUB (WS-1 owns): shows what the agent can see, with a share toggle. */
export interface ContextStripProps {
  view: StudioViewState;
  compact?: boolean;
  onShareChange?(share: boolean): void;
}
export function ContextStrip(_props: ContextStripProps) {
  return null;
}
