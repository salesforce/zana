import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: {}, app: { getPath: () => '/tmp' } }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [] } }));

import { focusMenubarAgent } from './terminals.js';

function deps(session: { projectId: string } | null = null) {
  return {
    ptys: { getSession: vi.fn(() => session) },
    showMainWindow: vi.fn(),
    ensureMainWindowReady: vi.fn().mockResolvedValue(true),
    openMenubarThread: vi.fn().mockResolvedValue({ ok: true }),
    logMainError: vi.fn(),
    safeSend: vi.fn(),
    menubar: { hide: vi.fn() }
  };
}

describe('focusMenubarAgent', () => {
  it('waits for renderer readiness before opening a Thread', async () => {
    const value = deps();
    value.ensureMainWindowReady.mockResolvedValue(false);
    await focusMenubarAgent(value, 'thread', 't1', 'p1');
    expect(value.showMainWindow).toHaveBeenCalledOnce();
    expect(value.openMenubarThread).not.toHaveBeenCalled();
    expect(value.logMainError).toHaveBeenCalledWith('menubar focus thread', expect.any(String));
  });

  it('logs rejected Thread opens and hides only after successful delivery', async () => {
    const value = deps();
    value.openMenubarThread.mockResolvedValueOnce({ ok: false, reason: 'thread unavailable' });
    await focusMenubarAgent(value, 'thread', 't1', 'p1');
    expect(value.logMainError).toHaveBeenCalledWith('menubar focus thread', 'thread unavailable');
    expect(value.menubar.hide).not.toHaveBeenCalled();
    value.openMenubarThread.mockResolvedValueOnce({ ok: true });
    await focusMenubarAgent(value, 'thread', 't1', 'p1');
    expect(value.menubar.hide).toHaveBeenCalledOnce();
  });

  it('authorizes legacy CLI focus against main session state', async () => {
    const value = deps({ projectId: 'p1' });
    await focusMenubarAgent(value, 'cli', 's1', 'wrong');
    expect(value.safeSend).not.toHaveBeenCalled();
    await focusMenubarAgent(value, 'cli', 's1', 'p1');
    expect(value.safeSend).toHaveBeenCalledWith('app:focusSession', 's1', 'p1');
  });
});
