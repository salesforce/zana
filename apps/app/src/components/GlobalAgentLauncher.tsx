import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { AgentLauncher } from './AgentLauncher.js';

interface Props {
  open: boolean;
  project?: Project;
  /** Project the launcher was opened for; preselected when `project` is unset. */
  initialProjectId?: string;
  onClose: () => void;
  onLaunched: (session: TerminalSession, projectId: string) => void;
}

export function GlobalAgentLauncher({ open, project, initialProjectId, onClose, onLaunched }: Props) {
  if (!open) return null;
  return <AgentLauncher project={project} initialProjectId={initialProjectId} onClose={onClose} onLaunched={onLaunched} />;
}
