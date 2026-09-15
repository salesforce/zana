import { describe, expect, it } from 'vitest';
import type { AgentState, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  agentViewTerminals,
  listedTerminals,
  projectRailTerminals,
  RAIL_REMEMBERED_AGENT_LIMIT
} from '../store.js';

function session(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: 's',
    projectId: 'p',
    title: 't',
    profile: 'claude',
    cwd: '/tmp',
    status: 'running',
    createdAt: 0,
    ...over
  } as TerminalSession;
}

describe('agentViewTerminals', () => {
  const interactive = session({ id: 'i' });
  const waiting = session({ id: 'wait', scheduled: true });
  const working = session({ id: 'work', scheduled: true });
  const blocked = session({ id: 'block', scheduled: true });
  const exited = session({ id: 'done', scheduled: true, status: 'exited' });
  const list = [interactive, waiting, working, blocked, exited];
  const stateById: Record<string, AgentState> = {
    wait: 'idle',
    work: 'working',
    block: 'blocked',
    done: 'idle'
  };

  it('drops waiting and exited scheduled sessions when includeScheduled is off', () => {
    expect(listedTerminals(list).map((t) => t.id)).toEqual(['i']);
    expect(agentViewTerminals(list, false, stateById).map((t) => t.id)).toEqual([
      'i',
      'work',
      'block'
    ]);
  });

  it('treats a scheduled session with no AgentState as waiting', () => {
    expect(agentViewTerminals([interactive, waiting], false).map((t) => t.id)).toEqual(['i']);
    expect(
      agentViewTerminals([interactive, waiting], false, { wait: 'unknown' }).map((t) => t.id)
    ).toEqual(['i']);
  });

  it('keeps all scheduled sessions when includeScheduled is on', () => {
    expect(agentViewTerminals(list, true, stateById).map((t) => t.id)).toEqual([
      'i',
      'wait',
      'work',
      'block',
      'done'
    ]);
  });

  it('does not change listedTerminals when includeScheduled is on', () => {
    expect(listedTerminals(list).map((t) => t.id)).toEqual(['i']);
  });

  it('drops scheduled agents from the project rail, even while they are running', () => {
    expect(projectRailTerminals(list).map((t) => t.id)).toEqual(['i']);
  });

  it('nests remembered exited cards after live ones', () => {
    const remembered = session({
      id: 'old',
      status: 'exited',
      remembered: true,
      finishedAt: 1
    });
    expect(projectRailTerminals([interactive, remembered, exited]).map((t) => t.id)).toEqual([
      'i',
      'old'
    ]);
  });

  it('caps remembered exited cards like idle threads', () => {
    const remembered = Array.from({ length: RAIL_REMEMBERED_AGENT_LIMIT + 3 }, (_, i) =>
      session({
        id: `old-${i}`,
        status: 'exited',
        remembered: true,
        finishedAt: i
      })
    );
    expect(projectRailTerminals([interactive, ...remembered]).map((t) => t.id)).toEqual([
      'i',
      ...remembered
        .slice()
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
        .slice(0, RAIL_REMEMBERED_AGENT_LIMIT)
        .map((t) => t.id)
    ]);
  });
});
