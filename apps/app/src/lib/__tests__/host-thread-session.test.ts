import { describe, expect, it } from 'vitest';
import { sessionFromHostThread, threadEventToTerminalData, threadEventToTerminalExit } from '../host-thread-session.js';

describe('sessionFromHostThread', () => {
  it('maps a running claude thread onto a terminal session', () => {
    expect(sessionFromHostThread({
      id: 'thr-1',
      projectId: 'proj-1',
      providerId: 'claude',
      status: 'running',
      title: 'Fix the board',
      createdAt: 42
    }, { path: '/tmp/proj' })).toMatchObject({
      id: 'thr-1',
      projectId: 'proj-1',
      profile: 'claude',
      cwd: '/tmp/proj',
      status: 'running',
      title: 'Fix the board',
      createdAt: 42
    });
  });

  it('uses the environment cwd and stamps workspaceEnvironmentId', () => {
    expect(sessionFromHostThread({
      id: 'thr-4',
      projectId: 'proj-1',
      providerId: 'claude',
      status: 'running',
      title: 'Worktree',
      createdAt: 3,
      environmentId: '11111111-1111-4111-8111-111111111111',
      cwd: '/tmp/.zcc/worktrees/env/demo',
      branchName: 'zcc/feat',
      isWorktree: true
    }, { path: '/tmp/proj' })).toMatchObject({
      cwd: '/tmp/.zcc/worktrees/env/demo',
      workspaceEnvironmentId: '11111111-1111-4111-8111-111111111111',
      worktree: { path: '/tmp/.zcc/worktrees/env/demo', branch: 'zcc/feat' }
    });
  });

  it('treats failed and completed threads as exited', () => {
    expect(sessionFromHostThread({
      id: 'thr-2',
      projectId: 'proj-1',
      providerId: 'unknown-family',
      status: 'failed',
      title: null,
      createdAt: 1
    }).status).toBe('exited');
    expect(sessionFromHostThread({
      id: 'thr-3',
      projectId: 'proj-1',
      providerId: 'codex',
      status: 'completed',
      title: '  ',
      createdAt: 1
    })).toMatchObject({
      profile: 'codex',
      status: 'exited',
      title: 'Agent'
    });
  });
});

describe('threadEventToTerminalData', () => {
  it('extracts PTY bytes from a terminal.output host event', () => {
    expect(threadEventToTerminalData({
      threadId: 'thr-1',
      kind: 'terminal.output',
      payload: { data: 'hello' }
    })).toEqual({ sessionId: 'thr-1', data: 'hello' });
  });

  it('ignores non-output events', () => {
    expect(threadEventToTerminalData({
      threadId: 'thr-1',
      kind: 'thread.started'
    })).toBeNull();
  });
});

describe('threadEventToTerminalExit', () => {
  it('maps turn.failed onto a non-zero exit', () => {
    expect(threadEventToTerminalExit({
      threadId: 'thr-1',
      kind: 'turn.failed',
      payload: { exitCode: 1 }
    })).toEqual({ sessionId: 'thr-1', code: 1 });
  });
});
