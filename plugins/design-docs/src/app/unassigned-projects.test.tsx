// @vitest-environment happy-dom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnassignedProjectsDialog } from './UnassignedProjects.js';
import { createApi, type UnassignedProject } from './api.js';
import { createHarness } from './test-harness.js';
import { NavPanel } from './slots.js';

const item: UnassignedProject = {
  foreignProjectId: 'far-1',
  docCount: 2,
  sampleTitles: ['Alpha', 'Beta'],
  suggestion: { projectId: 'p1', name: 'App', basis: 'name' }
};

describe('api wrapper', () => {
  it('calls the mapping RPCs', async () => {
    const call = vi.fn(async () => ({}));
    const api = createApi(call);
    await api.listUnassignedProjects();
    await api.removedProjects();
    await api.listProjectMappings();
    await api.mapForeignProject('f', 'l');
    await api.unmapForeignProject('f');
    await api.list({ unassigned: true });
    expect(call.mock.calls).toEqual([
      ['listUnassignedProjects', undefined],
      ['removedProjects', undefined],
      ['listProjectMappings', undefined],
      ['mapForeignProject', { foreignProjectId: 'f', localProjectId: 'l' }],
      ['unmapForeignProject', { foreignProjectId: 'f' }],
      ['list', { unassigned: true }]
    ]);
  });
});

const setup = (map: (args: unknown) => unknown, extra: Record<string, (args?: unknown) => unknown> = {}) => {
  const calls: unknown[] = [];
  const harness = createHarness({
    rpcOverrides: {
      mapForeignProject: (args) => {
        calls.push(args);
        return map(args);
      },
      ...extra
    }
  });
  return { harness, calls };
};
const projects = [{ id: 'p1', name: 'App' }, { id: 'p2', name: 'Site' }];

describe('UnassignedProjectsDialog', () => {
  it('maps only after an explicit pick and Confirm; suggestion is not applied by itself', async () => {
    const { harness, calls } = setup(async () => ({}));
    const onChanged = vi.fn();
    harness.render(<UnassignedProjectsDialog unassigned={[item]} projects={projects} onClose={() => undefined} onChanged={onChanged} />);
    const dialog = screen.getByRole('dialog', { name: 'Map peer projects' });
    expect(within(dialog).getByText(/far-1 · 2 docs/)).toBeTruthy();
    expect(within(dialog).getByText('Alpha · Beta')).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use suggestion' }));
    expect((within(dialog).getByLabelText('Local Project for far-1') as HTMLSelectElement).value).toBe('p1');
    expect(calls).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText('Local Project for far-1'), { target: { value: 'p2' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([{ foreignProjectId: 'far-1', localProjectId: 'p2' }]);
  });

  it('reports a failed mapping and shows an empty state', async () => {
    const { harness } = setup(async () => {
      throw new Error('nope');
    });
    const onChanged = vi.fn();
    const view = harness.render(<UnassignedProjectsDialog unassigned={[{ ...item, suggestion: null, sampleTitles: [] }]} projects={projects} onClose={() => undefined} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('Local Project for far-1'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(harness.toasts.some((toast) => toast.kind === 'error' && toast.message.includes('nope'))).toBe(true));
    expect(onChanged).not.toHaveBeenCalled();
    view.unmount();
    harness.render(<UnassignedProjectsDialog unassigned={[]} projects={[]} onClose={() => undefined} onChanged={onChanged} />);
    expect(screen.getByText('Nothing to map.')).toBeTruthy();
  });
});

describe('Mapped on this machine', () => {
  const mapping = { foreignProjectId: 'far-9', localProjectId: 'p1', docCount: 1, sampleTitles: ['Zed'], localRegistered: true };
  const dead = { foreignProjectId: 'far-8', localProjectId: 'gone', docCount: 2, sampleTitles: [], localRegistered: false };
  const open = (extra: Record<string, (args?: unknown) => unknown>) => {
    const { harness } = setup(async () => ({}), { listProjectMappings: () => [mapping, dead], ...extra });
    const onChanged = vi.fn();
    harness.render(<UnassignedProjectsDialog unassigned={[]} projects={projects} onClose={() => undefined} onChanged={onChanged} />);
    return { harness, onChanged };
  };

  it('lists mappings and unmaps only after confirmation', async () => {
    const calls: unknown[] = [];
    const { onChanged } = open({ unmapForeignProject: (args) => { calls.push(args); return { removed: true }; } });
    const section = await screen.findByRole('region', { name: 'Mapped on this machine' });
    expect(within(section).getByText(/far-9 → App · 1 doc/)).toBeTruthy();
    expect(within(section).getByText(/far-8 → Project removed · 2 docs/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: 'Unmap far-9' }));
    expect(calls).toEqual([]);
    fireEvent.click(within(section).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Unmap far-9' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm unmap' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([{ foreignProjectId: 'far-9' }]);
  });

  it('shows an error toast when unmap fails', async () => {
    const { harness, onChanged } = open({ unmapForeignProject: () => { throw new Error('boom'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Unmap far-9' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unmap' }));
    await waitFor(() => expect(harness.toasts.some((toast) => toast.kind === 'error' && toast.message.includes('boom'))).toBe(true));
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('Workbench unassigned bucket', () => {
  it('lists unassigned docs in their own group, shows removed names, and opens the mapping dialog', async () => {
    const doc = (id: string, title: string, projectId: string | null) => ({ id, title, summary: '', tags: [], status: 'draft', projectId, openComments: 0, pinnedAt: null, alternativeTo: null, lastComment: null, updatedAt: Date.now(), createdAt: Date.now(), updatedBy: { kind: 'user', label: 'me' } });
    const calls: unknown[] = [];
    const { harness } = setup(async () => ({}), {
      list: (args) => (calls.push(args), (args as { unassigned?: boolean } | null)?.unassigned ? [doc('u1', 'Peer doc', null)] : [doc('d1', 'Gone doc', 'gone')]),
      listUnassignedProjects: () => [item],
      removedProjects: () => [{ id: 'gone', label: 'Old (project removed)' }]
    });
    harness.render(<NavPanel pluginId="design-docs" />);
    const group = await screen.findByRole('region', { name: 'Unassigned from peers' });
    expect(within(group).getByText('Peer doc')).toBeTruthy();
    expect((await screen.findAllByText('Old (project removed)')).length).toBeGreaterThan(0);
    fireEvent.click(within(group).getByRole('button', { name: /Map to a Project/ }));
    expect(await screen.findByRole('dialog', { name: 'Map peer projects' })).toBeTruthy();
    // The all-projects list excludes unassigned docs so they are not also shown under Global.
    expect(calls.some((args) => (args as { excludeUnassigned?: boolean }).excludeUnassigned === true)).toBe(true);
  });
});
