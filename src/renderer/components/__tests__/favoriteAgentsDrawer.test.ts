import { describe, it, expect } from 'vitest';
import { sectionOf } from '../FavoriteAgentsDrawer';
import type { AgentCard } from '../AgentBoard';
import type { AgentState, TerminalSession } from '@shared/types';

// Minimal AgentCard for section-bucketing tests. Only the fields sectionOf reads
// (`status`, `headless`, and the card `state`) matter here.
function card(
  state: AgentState,
  status: TerminalSession['status'],
  opts: { headless?: boolean; exitCode?: number } = {}
): AgentCard {
  return {
    session: {
      id: 's',
      projectId: 'p',
      title: 't',
      profile: 'claude',
      cwd: '/tmp',
      status,
      exitCode: opts.exitCode,
      headless: opts.headless,
      createdAt: 0
    } as TerminalSession,
    state,
    projectId: 'p',
    projectName: 'Proj'
  };
}

describe('FavoriteAgentsDrawer sectionOf', () => {
  it('routes a blocked, foreground agent to Needs you', () => {
    expect(sectionOf(card('blocked', 'running'))).toBe('blocked');
  });

  it('routes a working, foreground agent to Working', () => {
    expect(sectionOf(card('working', 'running'))).toBe('working');
  });

  it('routes idle / done / unknown live foreground agents to Idle', () => {
    expect(sectionOf(card('idle', 'running'))).toBe('idle');
    expect(sectionOf(card('done', 'running'))).toBe('idle');
    expect(sectionOf(card('unknown', 'running'))).toBe('idle');
  });

  it('sinks any live headless agent to Background, whatever its state', () => {
    expect(sectionOf(card('working', 'running', { headless: true }))).toBe('background');
    expect(sectionOf(card('blocked', 'running', { headless: true }))).toBe('background');
    expect(sectionOf(card('idle', 'starting', { headless: true }))).toBe('background');
  });

  it('routes any exited agent to Done — even a headless one (exited wins)', () => {
    expect(sectionOf(card('working', 'exited', { exitCode: 0 }))).toBe('done');
    expect(sectionOf(card('idle', 'exited', { exitCode: 1 }))).toBe('done');
    expect(sectionOf(card('idle', 'exited', { headless: true, exitCode: 0 }))).toBe('done');
  });
});
