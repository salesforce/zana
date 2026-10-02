import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { AgentLauncher } from './AgentLauncher.js';

interface Props {
  open: boolean;
  project?: Project;
  onClose: () => void;
  onLaunched: (session: TerminalSession, projectId: string) => void;
}

export function GlobalAgentLauncher({ open, project, onClose, onLaunched }: Props) {
  if (!open) return null;
  return <AgentLauncher project={project} onClose={onClose} onLaunched={onLaunched} />;
}
