import { describe, expect, it } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { agentViewTerminals, listedTerminals } from '../store.js';

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
  const scheduled = session({ id: 'sch', scheduled: true });
  const list = [interactive, scheduled];

  it('drops scheduled sessions by default, matching listedTerminals', () => {
    expect(listedTerminals(list).map((t) => t.id)).toEqual(['i']);
    expect(agentViewTerminals(list, false).map((t) => t.id)).toEqual(['i']);
  });

  it('keeps scheduled sessions when includeScheduled is on', () => {
    expect(agentViewTerminals(list, true).map((t) => t.id)).toEqual(['i', 'sch']);
  });

  it('does not change listedTerminals when includeScheduled is on', () => {
    expect(listedTerminals(list).map((t) => t.id)).toEqual(['i']);
  });
});
