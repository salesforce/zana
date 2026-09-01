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

/**
 * Live agent-state dot. Subscribes by id to a PRIMITIVE (the state string), so
 * one session's transition repaints only its own dot. Renders nothing for
 * `unknown` (plain shells, no signal yet). Mirrors TabBar's AgentStatusDot.
 */
export function AgentStatusDot({ sessionId }: { sessionId: string }) {
  const state = useAgentStatus((s) => s.byId[sessionId] ?? 'unknown');
  if (state === 'unknown') return null;
  return (
    <span
      className={`tab-agent-dot agent-${state}`}
      title={AGENT_STATE_LABEL[state]}
      aria-label={AGENT_STATE_LABEL[state]}
    />
  );
}
