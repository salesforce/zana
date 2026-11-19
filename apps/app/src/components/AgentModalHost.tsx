import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentStatus, useData, useUi } from '../store.js';
import { useCompactLayout } from '../hooks/useCompactLayout.js';
import { useIsCompactViewport } from '../hooks/useIsCompactViewport.js';
import { getAgentSessionRoutePath } from '../lib/route-paths.js';
import { inspectRouteProjectId } from '../lib/inspect-session.js';
import { AgentTerminalModal } from './AgentTerminalModal.js';

/** CLI agent inspector: a modal, or a hand-off to the session page when the main view hosts agents. */
export function AgentModalHost() {
  const classicSessionViewEnabled = useData((s) => s.classicSessionViewEnabled);
  const threadTabsEnabled = useData((s) => s.threadTabsEnabled);
  const isCompact = useIsCompactViewport();
  const fullPageView = useCompactLayout() || classicSessionViewEnabled || (threadTabsEnabled && !isCompact);
  const agentModal = useUi((s) => s.agentModal);
  const projects = useData((s) => s.projects);
  const terminals = useData((s) => s.terminals);
  const navigate = useNavigate();
  const state = useAgentStatus((s) => (agentModal ? s.byId[agentModal.sessionId] : undefined));
  const close = () => useUi.getState().closeAgentModal();
  useEffect(() => {
    if (!fullPageView || !agentModal) return;
    navigate(
      getAgentSessionRoutePath(
        agentModal.sessionId,
        inspectRouteProjectId(agentModal.projectId)
      )
    );
    useUi.getState().closeAgentModal();
  }, [fullPageView, agentModal, navigate]);
  if (fullPageView || !agentModal) return null;
  const session = (terminals[agentModal.projectId] ?? []).find(
    (t) => t.id === agentModal.sessionId
  );
  // The session can vanish while the modal is open (process terminated and the
  // tombstone dismissed). Drop the modal rather than render an empty shell.
  if (!session) return null;
  const project = projects.find((p) => p.id === agentModal.projectId);
  return (
    <AgentTerminalModal
      session={session}
      projectId={agentModal.projectId}
      projectName={project?.name ?? 'Unknown'}
      projectColor={project?.color}
      projectRemote={!!project?.remote}
      state={state ?? 'unknown'}
      onClose={close}
    />
  );
}
