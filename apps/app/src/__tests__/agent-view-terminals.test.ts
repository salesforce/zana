import { describe, expect, it } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { agentViewTerminals, listedTerminals, projectRailTerminals } from '../store.js';

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

  it('drops every scheduled session when includeScheduled is off, including working and blocked', () => {
    expect(listedTerminals(list).map((t) => t.id)).toEqual(['i']);
    expect(agentViewTerminals(list, false).map((t) => t.id)).toEqual(['i']);
  });

  it('drops a waiting scheduled session when includeScheduled is off', () => {
    expect(agentViewTerminals([interactive, waiting], false).map((t) => t.id)).toEqual(['i']);
  });

  it('keeps all scheduled sessions when includeScheduled is on', () => {
    expect(agentViewTerminals(list, true).map((t) => t.id)).toEqual([
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

  it('dumps exited CLI agents instead of nesting them like idle threads', () => {
    const remembered = session({
      id: 'old',
      status: 'exited',
      remembered: true,
      finishedAt: 1
    });
    expect(projectRailTerminals([interactive, remembered, exited]).map((t) => t.id)).toEqual(['i']);
  });
});
