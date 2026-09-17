import { describe, expect, it } from 'vitest';
import { openThreadTerminal, RunInTerminalError } from './open-thread-terminal.js';
import type { OpenThreadTerminalDeps } from './open-thread-terminal.js';

function deps(over: Partial<OpenThreadTerminalDeps> = {}): OpenThreadTerminalDeps & { emitted: unknown[] } {
  const emitted: unknown[] = [];
  return {
    emitted,
    getThread: (id) => (id === 'thr-1' ? { id: 'thr-1', projectId: 'proj-1' } : null),
    getProject: (projectId) => (projectId === 'proj-1' ? { id: 'proj-1' } : null),
    emit: (payload) => {
      emitted.push(payload);
      return 1;
    },
    ...over
  };
}

describe('openThreadTerminal', () => {
  it('emits a threads:open terminal intent from the owning thread identity', () => {
    const d = deps();
    const result = openThreadTerminal(d, {
      threadId: 'thr-1',
      projectId: 'forged-proj',
      command: 'npm run dev',
      title: 'Dev server'
    });
    expect(result).toMatchObject({
      delivered: 1,
      threadId: 'thr-1',
      projectId: 'proj-1',
      command: 'npm run dev',
      title: 'Dev server'
    });
    expect(d.emitted[0]).toMatchObject({
      type: 'thread-open',
      threadId: 'thr-1',
      projectId: 'proj-1',
      file: null,
      terminal: { command: 'npm run dev', title: 'Dev server' }
    });
  });

  it('opens an idle shell when command is empty', () => {
    const d = deps();
    const result = openThreadTerminal(d, {
      threadId: 'thr-1',
      command: '   '
    });
    expect(result.command).toBeNull();
    expect(result.title).toBe('Terminal');
  });

  it('rejects an overlong title', () => {
    const d = deps();
    expect(() => openThreadTerminal(d, { threadId: 'thr-1', title: 'x'.repeat(201) }))
      .toThrow(/too long/);
  });

  it('uses a PTY session id with the fallback projectId', () => {
    const d = deps({
      getThread: () => null,
      getProject: (projectId) => (projectId === 'proj-1' ? { id: 'proj-1' } : null)
    });
    const result = openThreadTerminal(d, { threadId: 'sess-pty', projectId: 'proj-1' });
    expect(result.threadId).toBe('sess-pty');
    expect(result.projectId).toBe('proj-1');
    expect(result.title).toBe('Terminal');
  });

  it('rejects a remote project', () => {
    const d = deps({
      getProject: () => ({ id: 'proj-1', remote: { host: 'box' } })
    });
    expect(() => openThreadTerminal(d, { threadId: 'thr-1' })).toThrow(RunInTerminalError);
    try {
      openThreadTerminal(d, { threadId: 'thr-1' });
    } catch (error) {
      expect(error).toMatchObject({ status: 409, code: 'remote-unsupported' });
    }
  });

  it('rejects an overlong command and a missing project', () => {
    const d = deps();
    expect(() => openThreadTerminal(d, { threadId: 'thr-1', command: 'a'.repeat(10_001) }))
      .toThrow(/too long/);
    const missing = deps({ getProject: () => null });
    expect(() => openThreadTerminal(missing, { threadId: 'thr-1' })).toThrow(RunInTerminalError);
  });
});
