import { providerCapabilities } from '@zana-ai/zcc-domain/launch-provider';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { useData, useAgentStatus } from '../../store.js';
import { agentSessionAnchorId } from '../../lib/split-layout/agentSessionPortal.js';
import { AgentSessionView } from '../../components/AgentSessionView.js';
import { AgentSessionActions } from '../../components/AgentSessionActions.js';

function findSessionById(
  terminals: Record<string, TerminalSession[]>,
  sessionId: string,
  projectId: string | null
): { session: TerminalSession; projectId: string } | null {
  if (projectId) {
    const session = (terminals[projectId] ?? []).find((row) => row.id === sessionId);
    return session ? { session, projectId } : null;
  }
  for (const [id, list] of Object.entries(terminals)) {
    const session = list.find((row) => row.id === sessionId);
    if (session) return { session, projectId: id };
  }
  return null;
}

/**
 * First-class CLI-agent page in the split workspace. Looks up the live session
 * from main's store (never from renderer free-text beyond the routed ids) and
 * hosts {@link AgentSessionView} with the same footer actions as the inspector
 * modal. A vanished session (terminated and dismissed) shows an empty state.
 */
export function AgentSessionPage({
  projectId,
  sessionId
}: {
  projectId: string | null;
  sessionId: string;
}) {
  const session = useData(
    (s) => findSessionById(s.terminals, sessionId, projectId)?.session ?? null
  );
  const resolvedProjectId = useData(
    (s) => findSessionById(s.terminals, sessionId, projectId)?.projectId ?? null
  );
  const project = useData(
    (s) => s.projects.find((row) => row.id === resolvedProjectId) ?? null
  );
  const state = useAgentStatus((s) => s.byId[sessionId] ?? 'unknown');
  const heartbeatEnabled = useData((s) => s.heartbeatEnabled);

  if (!session || !resolvedProjectId) {
    return (
      <div className="thread-detail-empty" data-testid="agent-session-missing">
        This CLI agent is no longer running.
      </div>
    );
  }

  const exited = session.status === 'exited';
  const canHeartbeat =
    heartbeatEnabled &&
    providerCapabilities(session.profile).supportsHooks &&
    !exited &&
    !session.scheduled &&
    !session.headless;

  return (
    <AgentSessionView
      session={session}
      projectId={resolvedProjectId}
      projectName={project?.name ?? 'Unknown'}
      projectColor={project?.color}
      projectRemote={!!project?.remote}
      state={state}
      terminalAnchorId={agentSessionAnchorId(sessionId)}
      showProject
      background={session.scheduled}
      heartbeat={
        canHeartbeat
          ? {
              checked: session.heartbeat ?? false,
              onToggle: () => {
                void useData.getState().setHeartbeat(session.id, resolvedProjectId, !session.heartbeat);
              }
            }
          : null
      }
      footer={<AgentSessionActions session={session} projectId={resolvedProjectId} state={state} />}
    />
  );
}
