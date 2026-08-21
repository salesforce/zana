import { describe, it, expect } from 'vitest';
import { LANES, type AgentCard } from '../AgentBoard.js';
import type { AgentState, TerminalSession } from '@zana-ai/zcc-domain/product';

// Build a minimal AgentCard for lane-classification tests. Only the fields the
// LANE matchers read (`status`, `exitCode`, `state`) matter.
function card(state: AgentState, status: TerminalSession['status'], exitCode?: number): AgentCard {
  return {
    session: {
      id: 's',
      projectId: 'p',
      title: 't',
      profile: 'claude',
      cwd: '/tmp',
      status,
      exitCode,
      createdAt: 0
    } as TerminalSession,
    state,
    projectId: 'p',
    projectName: 'Proj'
  };
}

/** Which lane (if any) a card lands in. The board renders a card in the FIRST
 *  matching lane, mirroring `LANES.map(... filter(match))` — but the matchers
 *  are mutually exclusive, so "first match" and "only match" coincide. */
function laneFor(c: AgentCard): string | null {
  const hit = LANES.find((l) => l.match(c));
  return hit ? hit.key : null;
}

describe('AgentBoard LANES classification', () => {
  it('routes a blocked, running agent to Needs you', () => {
    expect(laneFor(card('blocked', 'running'))).toBe('blocked');
  });

  it('routes a working agent to Working', () => {
    expect(laneFor(card('working', 'running'))).toBe('working');
  });

  it('routes idle / done / unknown live agents to Idle', () => {
    expect(laneFor(card('idle', 'running'))).toBe('idle');
    expect(laneFor(card('done', 'running'))).toBe('idle');
    expect(laneFor(card('unknown', 'running'))).toBe('idle');
    expect(laneFor(card('idle', 'starting'))).toBe('idle');
  });

  it('routes any exited agent to Done regardless of last state', () => {
    expect(laneFor(card('working', 'exited', 0))).toBe('done');
    expect(laneFor(card('blocked', 'exited', 1))).toBe('done');
    expect(laneFor(card('idle', 'exited', 0))).toBe('done');
  });

  it('classifies every card into exactly one lane (no agent ever hidden)', () => {
    const states: AgentState[] = ['blocked', 'working', 'idle', 'done', 'unknown'];
    const statuses: TerminalSession['status'][] = ['starting', 'running', 'exited'];
    for (const s of states) {
      for (const st of statuses) {
        const matches = LANES.filter((l) => l.match(card(s, st)));
        expect(matches.length).toBe(1);
      }
    }
  });
});
