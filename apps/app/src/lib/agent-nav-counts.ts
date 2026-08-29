import type { AgentState, TerminalSession } from '@zana-ai/zcc-domain/product';
import { threadStatusToAgentState } from '../components/thread/thread-timeline-model.js';

export interface AgentNavCountThread {
  projectId: string;
  status: string;
  archivedAt?: number | null;
  hasPendingInteraction?: boolean;
}

function isLiveAgentProcess(session: Pick<TerminalSession, 'status'>): boolean {
  return session.status === 'running' || session.status === 'starting';
}

export function agentNavCounts(input: {
  terminals: Record<string, TerminalSession[] | undefined>;
  agentStateById: Record<string, AgentState | undefined>;
  threads?: readonly AgentNavCountThread[];
  scopeProjectId?: string | null;
}): { active: number; blocked: number } {
  let active = 0;
  let blocked = 0;
  const lists = input.scopeProjectId
    ? [input.terminals[input.scopeProjectId] ?? []]
    : Object.values(input.terminals);
  for (const list of lists) {
    for (const session of list) {
      if (session.profile === 'shell') continue;
      const state = input.agentStateById[session.id];
      if (state === 'blocked') {
        active += 1;
        blocked += 1;
      } else if (state === 'working' || (isLiveAgentProcess(session) && state !== 'done')) {
        // Live pty sessions count even before a working/blocked status arrives
        // (unknown) and while the agent is idle between turns — the process is
        // still running, which is what the Agents nav badge is for.
        active += 1;
      }
    }
  }
  for (const thread of input.threads ?? []) {
    if (thread.archivedAt) continue;
    if (input.scopeProjectId && thread.projectId !== input.scopeProjectId) continue;
    const state = threadStatusToAgentState(thread.status, thread.hasPendingInteraction);
    if (state === 'blocked') {
      active += 1;
      blocked += 1;
    } else if (state === 'working') {
      active += 1;
    }
  }
  return { active, blocked };
}
