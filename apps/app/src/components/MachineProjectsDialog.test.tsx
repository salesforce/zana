// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MachineProjectGroup } from '../lib/machine-projects.js';
import { MachineProjectsDialog } from './MachineProjectsDialog.js';

const h = vi.hoisted(() => ({ sync: null as any, threads: [] as Array<Record<string, unknown>> }));
vi.mock('../hooks/useMachineProjectSync.js', () => ({ useMachineProjectSync: () => h.sync }));
vi.mock('../thread-store.js', () => ({ useThreads: (select: (s: unknown) => unknown) => select(h) }));
vi.mock('../hooks/useProjectAvailability.js', () => ({ useProjectAvailability: () => ({ api: 'missing' }) }));
afterEach(() => { cleanup(); h.sync = null; });
const scratch = { id: 'default', name: 'Default Project', path: '/scratch', quickAgent: true };
function setup(primary = false, named = false, connected = false) {
  const group = { id: 'remote', name: 'Devbox', hostId: 'remote', primary, host: { status: connected ? 'connected' : 'disconnected' }, projects: [scratch, ...(named ? [{ id: 'api', name: 'API', path: '/api', remote: { host: 'dev', remotePath: '/srv/api' } }] : [])] } as MachineProjectGroup;
  const callbacks = { onClose: vi.fn(), onAdd: vi.fn(), onNewThread: vi.fn(), onOpenProject: vi.fn() };
  render(<MachineProjectsDialog group={group} {...callbacks} />);
  return { group, ...callbacks };
}
describe('machine overview', () => {
  it.each([
    [false, 'synced', 'Offline · showing saved projects'],
    [true, 'synced', 'Projects up to date'],
    [true, 'syncing', 'Syncing projects…'],
    [true, 'error', 'Project sync needs attention'],
  ])('shows cached sync state while connected=%s and status=%s', (connected, status, label) => {
    h.sync = { status, lastSyncedAt: 1_700_000_000_000, ...(status === 'error' ? { error: 'Network unavailable' } : {}) };
    setup(false, true, connected);
    expect(screen.getByRole('status').textContent).toContain(label);
    expect(screen.getByRole('status').querySelector('time')?.dateTime).toBe('2023-11-14T22:13:20.000Z');
    if (status === 'error') expect(screen.getByText('Network unavailable')).toBeTruthy();
  });
  it('counts current host threads, excludes archived and foreign defaults, and offers actions', () => {
    h.threads = [{ projectId: 'default', hostId: 'remote' }, { projectId: 'default', hostId: 'other' }, { projectId: 'default', hostId: 'remote', archivedAt: 1 }, { projectId: 'api', hostId: 'remote' }];
    const result = setup(false, true);
    expect(screen.queryByText('Ready to start')).toBeNull();
    expect(screen.getAllByText('1 thread')).toHaveLength(2);
    expect(screen.getByText('/srv/api')).toBeTruthy();
    expect(screen.getByText('Folder missing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check folders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Default Project', exact: true }));
    expect(result.onNewThread).toHaveBeenCalledWith(result.group, scratch);
    fireEvent.click(screen.getByRole('button', { name: 'API', exact: true }));
    expect(result.onOpenProject).toHaveBeenCalledWith(result.group.projects[1]);
    fireEvent.click(screen.getAllByRole('button', { name: 'New thread' })[1]);
    expect(result.onNewThread).toHaveBeenCalledWith(result.group, result.group.projects[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(result.onAdd).toHaveBeenCalledWith(result.group);
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(result.onClose).toHaveBeenCalled();
  });
  it('uses the local default for legacy threads and explains the empty machine', () => {
    h.threads = [{ projectId: 'default' }, { projectId: 'default', hostId: 'remote' }];
    const result = setup(true);
    expect(screen.getByText('2 threads')).toBeTruthy();
    expect(screen.getByText('Ready to start')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Default Project', exact: true }));
    expect(result.onOpenProject).toHaveBeenCalledWith(scratch);
  });
});
