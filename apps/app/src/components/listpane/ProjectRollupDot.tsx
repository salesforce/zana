import { useAgentStatus } from '../../store.js';
import type { AgentState } from '@zana-ai/zcc-domain/product';

/** Human label for the agent status dot's tooltip + aria. Mirrors TabBar. */
const AGENT_STATE_LABEL: Record<AgentState, string> = {
  blocked: 'Blocked — needs you',
  working: 'Working',
  done: 'Done — unseen',
  idle: 'Idle',
  unknown: '',
  waiting: 'Waiting for model'
};

/** Project rollup dot — the most-urgent agent state across the project's live
 *  sessions. Subscribes by project id to a PRIMITIVE so it repaints alone. */
export function ProjectRollupDot({ projectId }: { projectId: string }) {
  const state = useAgentStatus((s) => s.rollup[projectId] ?? 'unknown');
  if (state === 'unknown') return null;
  return (
    <span
      className={`tab-agent-dot agent-${state}`}
      title={AGENT_STATE_LABEL[state]}
      aria-label={AGENT_STATE_LABEL[state]}
    />
  );
}
