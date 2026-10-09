import type { StudioEngine } from '../../../lib/studio-contract.js';

/** STUB (WS-6 owns): unified Rehearse / Simulate / Live preview. */
export interface PreviewWorkbenchProps {
  pluginId: string;
  projectId?: string;
  /** Current editor source snapshot. */
  source: string;
  fileLabel: string;
  engine?: StudioEngine;
  onEngineChange?(engine: StudioEngine): void;
  onRevealSource?(path: string, line: number): void;
}
export function PreviewWorkbench(_props: PreviewWorkbenchProps) {
  return null;
}
