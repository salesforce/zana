import { describe, expect, it } from 'vitest';
import { asControlResult, cliAgentPresentationStatus, sessionToCliAgent } from './cli-agent-ops.js';

describe('cli-agent-ops helpers', () => {
  it('passes through a control-plane result', () => {
    expect(asControlResult({ ok: true, value: { id: 's1' } })).toEqual({ ok: true, value: { id: 's1' } });
    expect(asControlResult({ ok: false, code: 'NOT_FOUND', message: 'gone' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('projects a terminal session into the CLI Agent record', () => {
    expect(sessionToCliAgent({
      id: 's1',
      projectId: 'p1',
      profile: 'claude',
      title: 'hello',
      pid: 9
    }, 'idle')).toEqual({
      id: 's1',
      projectId: 'p1',
      profile: 'claude',
      title: 'hello',
      status: 'idle',
      pid: 9
    });
  });

  it('prefers an exited terminal over a dropped agent-status row', () => {
    expect(cliAgentPresentationStatus({ status: 'exited' }, 'unknown')).toBe('exited');
    expect(cliAgentPresentationStatus({ status: 'running' }, 'idle')).toBe('idle');
    expect(cliAgentPresentationStatus({ status: 'running' }, undefined)).toBe('running');
  });
});
