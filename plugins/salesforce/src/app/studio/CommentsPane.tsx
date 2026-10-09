import type { StudioComment } from '../../../lib/studio-contract.js';

/** STUB (WS-3 owns): review comments for the open file. */
export interface CommentsPaneProps {
  pluginId: string;
  projectId?: string;
  path: string | null;
  comments: StudioComment[];
  onReveal?(line: number): void;
  onResolve?(id: string, note: string): void;
  onAddressWithAgent?(): void;
}
export function CommentsPane(_props: CommentsPaneProps) {
  return null;
}
