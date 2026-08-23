import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { useData, useUi } from '../store.js';

const close = vi.fn();

vi.mock('../lib/product-client.js', () => ({
  product: {
    terminals: { close: (...args: unknown[]) => close(...args) },
    git: { status: vi.fn().mockRejectedValue(new Error('no git')) }
  }
}));

function session(id: string, over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    projectId: 'project-1',
    title: id,
    profile: 'claude',
    cwd: '/tmp/p',
    status: 'running',
    createdAt: 1,
    ...over
  } as TerminalSession;
}

beforeEach(() => {
  close.mockReset();
  useData.setState({
    projects: [{ id: 'project-1', name: 'P', path: '/tmp/p', createdAt: 1, lastActiveAt: 1 }],
    terminals: { 'project-1': [session('keep'), session('ghost')] },
    closedTabs: {},
    detachedStack: {}
  });
  useUi.setState({ toasts: [], selectedTabId: { 'project-1': 'ghost' } });
});

describe('useData.closeTerminal dismisses stale cards', () => {
  it('drops the card when close returns false', async () => {
    close.mockResolvedValue(false);

    await useData.getState().closeTerminal('ghost', 'project-1');

    expect(useData.getState().terminals['project-1'].map((row) => row.id)).toEqual(['keep']);
    expect(useUi.getState().toasts.at(-1)?.message).toMatch(/Removed from the board/);
  });

  it('drops the card when close throws', async () => {
    close.mockRejectedValue(new Error('host unreachable'));

    await useData.getState().closeTerminal('ghost', 'project-1');

    expect(useData.getState().terminals['project-1'].map((row) => row.id)).toEqual(['keep']);
    expect(useUi.getState().toasts.some((toast) => /Removed from the board/.test(toast.message))).toBe(true);
  });

  it('does not warn when the process actually stopped', async () => {
    close.mockResolvedValue(true);

    await useData.getState().closeTerminal('ghost', 'project-1');

    expect(useData.getState().terminals['project-1'].map((row) => row.id)).toEqual(['keep']);
    expect(useUi.getState().toasts.some((toast) => /Removed from the board/.test(toast.message))).toBe(false);
  });
});
