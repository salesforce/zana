import { useAgentStatus, useSubagents } from '../../store.js';
import type { TerminalSession, AgentState } from '@zana-ai/zcc-domain/product';
import { agentCardRuntimeLabel, agentRowStateClass } from '../fleet-item.js';

/** Compact state words for an agent's detail subtitle (the verbose
 *  AGENT_STATE_LABEL reads as a tooltip; the inline line stays terse). */
const AGENT_STATE_SHORT: Record<AgentState, string> = {
  blocked: 'Needs you',
  working: 'Working',
  done: 'Done',
  idle: 'Idle',
  unknown: ''
};

/** Relative "Ns/Nm/Nh/Nd ago" — mirrors OverviewPanel's timeAgo. */
function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/**
 * One-line agent detail under the session title in the rail: live state +
 * harness/runtime (same copy as the board card) + how long it's been running.
 * Subscribes by id to the state PRIMITIVE so a sibling's transition doesn't
 * repaint this row.
 */
export function AgentRowDetail({
  session,
  projectRemote = false
}: {
  session: TerminalSession;
  projectRemote?: boolean;
}) {
  const state = useAgentStatus((s) => s.byId[session.id] ?? 'unknown');
  // Live sub-agent (Task tool) fan-out count — primitive subscription so a
  // sibling's spawn doesn't repaint this row. Suppressed once exited.
  const subagents = useSubagents((s) => s.byId[session.id] ?? 0);
  const exited = session.status === 'exited';
  const stateText = exited ? '' : AGENT_STATE_SHORT[state];
  const subagentText =
    !exited && subagents > 0 ? `${subagents} sub-agent${subagents === 1 ? '' : 's'}` : '';
  const timeText = exited
    ? session.finishedAt
      ? `exited ${timeAgo(session.finishedAt)}`
      : 'exited'
    : session.status === 'starting'
      ? 'starting…'
      : `started ${timeAgo(session.createdAt)}`;
  const runtime = agentCardRuntimeLabel({ profile: session.profile, remote: projectRemote });
  const detailParts = [runtime, subagentText, timeText].filter(Boolean);
  if (!stateText && detailParts.length === 0) return null;
  return (
    <span className="project-terminal-detail">
      {stateText ? <span className={agentRowStateClass(state, exited)}>{stateText}</span> : null}
      {stateText && detailParts.length > 0 ? ' · ' : null}
      {detailParts.join(' · ')}
    </span>
  );
}
