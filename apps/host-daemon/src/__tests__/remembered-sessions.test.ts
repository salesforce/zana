import { describe, expect, it } from 'vitest';
import type { RestoreCapability } from '@zana-ai/zcc-server/services/launch/restore-capability-store';
import { isRememberedCapability, listRememberedTombstones, tombstoneFromCapability } from '../remembered-sessions.js';

function cap(over: Partial<RestoreCapability> & Pick<RestoreCapability, 'id' | 'request'>): RestoreCapability {
  return {
    createdAt: 10,
    ...over
  };
}

const ctx = {
  liveTmuxIds: new Set<string>(),
  livePtyIds: new Set<string>(),
  knownProjectIds: new Set(['p1'])
};

describe('isRememberedCapability', () => {
  it('keeps a user-opened agent for a known project', () => {
    expect(isRememberedCapability(cap({
      id: 'c1',
      request: { projectId: 'p1', profile: 'pi', cols: 80, rows: 24 },
      sessionId: 's1'
    }), ctx)).toBe(true);
  });

  it('drops scheduled, generic headless, shell, missing project, live pty, and live tmux', () => {
    const base = cap({
      id: 'c1',
      request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24 },
      sessionId: 's1'
    });
    expect(isRememberedCapability({
      ...base, request: { ...base.request, scheduled: true }
    }, ctx)).toBe(false);
    expect(isRememberedCapability({
      ...base, request: { ...base.request, headless: true }
    }, ctx)).toBe(false);
    expect(isRememberedCapability({
      ...base, request: { ...base.request, profile: 'shell' }
    }, ctx)).toBe(false);
    expect(isRememberedCapability(base, { ...ctx, knownProjectIds: new Set() })).toBe(false);
    expect(isRememberedCapability(base, { ...ctx, livePtyIds: new Set(['s1']) })).toBe(false);
    expect(isRememberedCapability(base, { ...ctx, liveTmuxIds: new Set(['s1']) })).toBe(false);
  });

  it('keeps a headless team worker', () => {
    expect(isRememberedCapability(cap({
      id: 'c1',
      request: {
        projectId: 'p1',
        profile: 'claude',
        cols: 80,
        rows: 24,
        headless: true,
        cohort: { cohortId: 'x', teamId: 't', teamName: 'T', role: 'worker' }
      },
      sessionId: 's1'
    }), ctx)).toBe(true);
  });
});

describe('tombstoneFromCapability', () => {
  it('paints an exited remembered card with restoreCapabilityId', () => {
    const session = tombstoneFromCapability(cap({
      id: 'cap-1',
      sessionId: 'sess-1',
      sessionTitle: 'Review',
      sessionProfile: 'pi',
      request: {
        projectId: 'p1',
        profile: 'pi',
        cols: 80,
        rows: 24,
        cwd: '/tmp/p',
        resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      },
      createdAt: 5,
      exitedAt: 9
    }));
    expect(session).toMatchObject({
      id: 'sess-1',
      restoreCapabilityId: 'cap-1',
      title: 'Review',
      profile: 'pi',
      status: 'exited',
      remembered: true,
      finishedAt: 9,
      nativeConversationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    });
  });

  it('does not invent a native conversation id for mastracode', () => {
    const session = tombstoneFromCapability(cap({
      id: 'cap-m',
      sessionId: 'sess-m',
      sessionProfile: 'mastracode',
      request: {
        projectId: 'p1',
        profile: 'mastracode',
        cols: 80,
        rows: 24,
        cwd: '/tmp/p'
      }
    }));
    expect(session.nativeConversationId).toBeUndefined();
    expect(session.claudeSessionId).toBeUndefined();
    expect(session.profile).toBe('mastracode');
    expect(session.remembered).toBe(true);
  });
});

describe('listRememberedTombstones', () => {
  it('filters then maps', () => {
    const listed = listRememberedTombstones([
      cap({
        id: 'keep',
        sessionId: 's-keep',
        request: { projectId: 'p1', profile: 'grok', cols: 80, rows: 24, cwd: '/tmp' }
      }),
      cap({
        id: 'drop',
        sessionId: 's-drop',
        request: { projectId: 'p1', profile: 'shell', cols: 80, rows: 24 }
      })
    ], ctx);
    expect(listed.map((row) => row.restoreCapabilityId)).toEqual(['keep']);
    expect(listed[0].remembered).toBe(true);
  });
});
