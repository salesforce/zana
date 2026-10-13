// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@zana-ai/zcc-domain/product';

const mocks = vi.hoisted(() => ({
  isRepo: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  pushToast: vi.fn(),
  changed: null as null | ((projectId: string) => void)
}));
vi.mock('@/store', () => ({
  useData: (select: (value: unknown) => unknown) => select({ updateProject: vi.fn() }),
  useUi: (select: (value: unknown) => unknown) => select({ pushToast: mocks.pushToast })
}));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: () => true }));
vi.mock('../../lib/product-client.js', () => ({
  product: {
    git: { isRepo: mocks.isRepo },
    projectSettings: {
      get: mocks.get,
      set: mocks.set,
      onChanged: (cb: (projectId: string) => void) => { mocks.changed = cb; return () => { mocks.changed = null; }; }
    }
  }
}));

import { ProjectWorktreeSettings } from './ProjectSettingsView.js';

const local = { id: 'p1', name: 'Proj', path: '/tmp/proj' } as Project;
const remote = { id: 'p2', name: 'R', path: '/r', remote: { host: 'h' } } as unknown as Project;

beforeEach(() => {
  mocks.isRepo.mockReset().mockResolvedValue(true);
  mocks.get.mockReset().mockResolvedValue({ worktreeIsolation: undefined });
  mocks.set.mockReset().mockImplementation(async (_id: string, patch: object) => patch);
  mocks.pushToast.mockReset();
});
afterEach(cleanup);

describe('ProjectWorktreeSettings Git probe', () => {
  it('shows a retryable probe error, not "not a Git project", when isRepo rejects', async () => {
    mocks.isRepo.mockRejectedValueOnce(new Error('ipc down'));
    render(<ProjectWorktreeSettings project={local} onSaved={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not check whether this project is a Git repository');
    expect(screen.queryByText(/Worktrees need a local Git project/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.isRepo).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Worktrees need a local Git project/)).toBeNull();
  });

  it('keeps showing the probe error when retry also fails', async () => {
    mocks.isRepo.mockRejectedValue(new Error('still down'));
    render(<ProjectWorktreeSettings project={local} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.isRepo).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('shows the unsupported message for a non-repo folder', async () => {
    mocks.isRepo.mockResolvedValue(false);
    render(<ProjectWorktreeSettings project={local} onSaved={vi.fn()} />);
    expect(await screen.findByText(/Worktrees need a local Git project/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('does not probe remote projects and reports them unsupported', async () => {
    render(<ProjectWorktreeSettings project={remote} onSaved={vi.fn()} />);
    expect(await screen.findByText(/Worktrees need a local Git project/)).toBeTruthy();
    expect(mocks.isRepo).not.toHaveBeenCalled();
  });

  it('surfaces a settings load failure', async () => {
    mocks.get.mockRejectedValue(new Error('read failed'));
    render(<ProjectWorktreeSettings project={local} onSaved={vi.fn()} />);
    expect((await screen.findByText(/read failed/)).textContent).toContain('Could not save project harness settings');
  });

  it('refreshes the value on an external change and ignores refresh failures', async () => {
    render(<ProjectWorktreeSettings project={local} onSaved={vi.fn()} />);
    await waitFor(() => expect(mocks.isRepo).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /Worktree isolation/ })).toBeTruthy());
    mocks.get.mockResolvedValueOnce({ worktreeIsolation: true });
    mocks.changed?.('p1');
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    mocks.get.mockRejectedValueOnce(new Error('x'));
    mocks.changed?.('p1');
    mocks.changed?.('other');
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(3));
  });

  it('ignores probe results that settle after unmount', async () => {
    let resolve!: (v: boolean) => void;
    mocks.isRepo.mockImplementationOnce(() => new Promise<boolean>((r) => { resolve = r; }));
    const view = render(<ProjectWorktreeSettings project={local} onSaved={vi.fn()} />);
    view.unmount();
    await act(async () => { resolve(true); });
    let reject!: (e: Error) => void;
    mocks.isRepo.mockImplementationOnce(() => new Promise<boolean>((_r, rej) => { reject = rej; }));
    const second = render(<ProjectWorktreeSettings project={local} onSaved={vi.fn()} />);
    second.unmount();
    await act(async () => { reject(new Error('late')); });
  });

  it('ignores a settings change that arrives before the Git probe resolves', async () => {
    mocks.isRepo.mockImplementationOnce(() => new Promise<boolean>(() => undefined));
    render(<ProjectWorktreeSettings project={local} onSaved={vi.fn()} />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    mocks.changed?.('p1');
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
