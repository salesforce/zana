import { describe, expect, it } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { agentNavCounts } from './agent-nav-counts.js';

function session(over: Partial<TerminalSession> & Pick<TerminalSession, 'id'>): TerminalSession {
  return {
    title: over.id,
    status: 'running',
    profile: 'claude',
    createdAt: 1,
    ...over
  } as TerminalSession;
}

describe('agentNavCounts', () => {
  it('counts working and blocked agents, ignoring shells', () => {
    expect(agentNavCounts({
      terminals: {
        p1: [
          session({ id: 'a', profile: 'claude' }),
          session({ id: 'b', profile: 'claude' }),
          session({ id: 'sh', profile: 'shell' })
        ]
      },
      agentStateById: { a: 'working', b: 'blocked', sh: 'working' }
    })).toEqual({ active: 2, blocked: 1 });
  });

  it('includes pending threads in the Agents badge, matching blocked agents', () => {
    expect(agentNavCounts({
      terminals: { p1: [session({ id: 'a' })] },
      agentStateById: { a: 'working' },
      threads: [
        { projectId: 'p1', status: 'active', hasPendingInteraction: true },
        { projectId: 'p1', status: 'active' },
        { projectId: 'p2', status: 'error' },
        { projectId: 'p1', status: 'active', hasPendingInteraction: true, archivedAt: 9 }
      ]
    })).toEqual({ active: 4, blocked: 2 });
  });

  it('scopes threads and agents to one project', () => {
    expect(agentNavCounts({
      terminals: {
        p1: [session({ id: 'a' })],
        p2: [session({ id: 'b' })]
      },
      agentStateById: { a: 'blocked', b: 'blocked' },
      threads: [
        { projectId: 'p1', status: 'active', hasPendingInteraction: true },
        { projectId: 'p2', status: 'active', hasPendingInteraction: true }
      ],
      scopeProjectId: 'p1'
    })).toEqual({ active: 2, blocked: 2 });
  });
});
