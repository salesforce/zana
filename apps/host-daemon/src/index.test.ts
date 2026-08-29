import { describe, expect, it } from 'vitest';
import { rejectMalformedExecutionCommand } from './index.js';

describe('rejectMalformedExecutionCommand', () => {
  it('rejects an untrusted malformed execution request before it reaches a host implementation', () => {
    expect(rejectMalformedExecutionCommand({ commandId: 'not-a-uuid' })).toEqual({
      kind: 'rejected',
      commandId: '00000000-0000-0000-0000-000000000000',
      reason: 'Invalid execution command'
    });
  });

  it('allows a syntactically valid server-issued command through validation', () => {
    expect(rejectMalformedExecutionCommand({
      kind: 'launch',
      commandId: '00000000-0000-4000-8000-000000000001',
      projectId: 'project-1',
      sessionId: 'session-1',
      deadlineAt: '2026-08-18T12:00:00.000Z',
      launch: {
        argv: ['claude'],
        cwd: '/authorized/project',
        env: { PATH: '/usr/bin' }
      }
    })).toBeNull();
  });
});
