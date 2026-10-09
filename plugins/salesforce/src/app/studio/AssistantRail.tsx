import type { StudioThreadLink, StudioViewState } from '../../../lib/studio-contract.js';

/** STUB (WS-1 owns): context strip + action chips + linked threads + embedded thread chat. */
export interface AssistantRailProps {
  pluginId: string;
  projectId?: string;
  /** Path of the open .agent file, or null for an unsaved draft. */
  path: string | null;
  view: StudioViewState;
  compact?: boolean;
  threads?: StudioThreadLink[];
  onAskAgent?(action: string, prompt?: string): void;
  onOpenThread?(threadId: string): void;
}
export function AssistantRail(_props: AssistantRailProps) {
  return null;
}
