import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import { useUi } from '../store.js';
import { AgentLauncher } from './AgentLauncher.js';

interface Props {
  open: boolean;
  project?: Project;
  onClose: () => void;
  onLaunched: (session: TerminalSession, projectId: string) => void;
}

export function GlobalAgentLauncher({ open, project, onClose, onLaunched }: Props) {
  // A project row's "+" records which project it was opened for.
  const launcherProjectId = useUi((s) => s.launcherProjectId);
  if (!open) return null;
  return (
    <AgentLauncher
      project={project}
      initialProjectId={launcherProjectId ?? undefined}
      onClose={onClose}
      onLaunched={onLaunched}
    />
  );
}
