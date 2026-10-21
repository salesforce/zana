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
  // A row's explicit target wins over sticky focus from an earlier project.
  // Keep the picker editable, just like any other launch from the global tree.
  const launcherProjectId = useUi((s) => s.launcherProjectId);
  if (!open) return null;
  return (
    <AgentLauncher
      project={launcherProjectId ? undefined : project}
      initialProjectId={launcherProjectId ?? undefined}
      onClose={onClose}
      onLaunched={onLaunched}
    />
  );
}
