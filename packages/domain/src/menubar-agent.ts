import type { AgentState, IdleResolution } from './product.js';

/** Identity and display projection shared by menu-bar producers and consumers. */
export type MenubarAgent = MenubarCliAgent | MenubarThreadAgent;

interface MenubarAgentBase {
  kind: 'cli' | 'thread';
  agentId: string;
  projectId: string;
  rowKey: string;
  projectName: string;
  projectColor?: string;
  title: string;
  state: AgentState;
  favorite: boolean;
  canFavorite: boolean;
  canReply: boolean;
  createdAt: number;
  question?: string;
  resolution?: IdleResolution;
}

export interface MenubarCliAgent extends MenubarAgentBase {
  kind: 'cli';
  sessionId: string;
  repliable: boolean;
}

export interface MenubarThreadAgent extends MenubarAgentBase {
  kind: 'thread';
  threadId: string;
  status: string;
  hasPendingInteraction: boolean;
}

/** Shared status projection for menu-bar thread rows. */
export function menubarAgentState(
  status: string,
  waitingOnUser = false,
  activeBackgroundCommandCount = 0
): AgentState {
  if (status === 'error') return 'blocked';
  if (waitingOnUser) return 'blocked';
  if (['active', 'host-reconnecting', 'provisioning', 'starting'].includes(status)) {
    return 'working';
  }
  return activeBackgroundCommandCount > 0 ? 'working' : 'idle';
}

export function menubarAgentRowKey(agent: Pick<MenubarAgent, 'kind' | 'agentId' | 'projectId'>): string {
  return `${agent.kind}:${agent.agentId}`;
}
