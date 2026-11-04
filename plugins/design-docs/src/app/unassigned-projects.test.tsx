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
  senderName: 'Sender App',
  senderTag: 'app',
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
  it('shows the sender name and titles, never the id; preselects the suggestion but maps only on Map', async () => {
    const { harness, calls } = setup(async () => ({}));
    const onChanged = vi.fn();
    harness.render(<UnassignedProjectsDialog unassigned={[{ ...item, docCount: 5 }]} projects={projects} onClose={() => undefined} onChanged={onChanged} />);
    const dialog = screen.getByRole('dialog', { name: 'Map projects from other computers' });
    expect(dialog.textContent).toContain('“Sender App”');
    expect(within(dialog).getByText(/From the project “Sender App”.*on another computer · 5 docs/)).toBeTruthy();
    expect(within(dialog).getByText('“Alpha” · “Beta” · +3 more')).toBeTruthy();
    expect(dialog.textContent).not.toContain('far-1');
    const select = within(dialog).getByLabelText('Your Project for Sender App') as HTMLSelectElement;
    expect(select.value).toBe('p1');
    expect(within(dialog).getByRole('option', { name: 'App (suggested: same name)' })).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.change(select, { target: { value: 'p2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Map' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([{ foreignProjectId: 'far-1', localProjectId: 'p2' }]);
  });

  it('maps the preselected suggestion when Map is pressed', async () => {
    const { harness, calls } = setup(async () => ({}));
    harness.render(<UnassignedProjectsDialog unassigned={[item]} projects={projects} onClose={() => undefined} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    await waitFor(() => expect(calls).toEqual([{ foreignProjectId: 'far-1', localProjectId: 'p1' }]));
  });

  it('labels a project without a sender name neutrally and tells rows apart by titles', () => {
    const { harness } = setup(async () => ({}));
    const a = { ...item, foreignProjectId: 'far-a', senderName: null, senderTag: null, suggestion: null, sampleTitles: ['Zeta doc'] };
    const b = { ...item, foreignProjectId: 'far-b', senderName: null, senderTag: null, suggestion: null, sampleTitles: ['Alpha doc'] };
    harness.render(<UnassignedProjectsDialog unassigned={[a, b]} projects={projects} onClose={() => undefined} onChanged={() => undefined} />);
    const sections = screen.getAllByRole('region', { name: 'Project Unnamed project' });
    expect(sections).toHaveLength(2);
    expect(sections[0]!.textContent).toContain('Alpha doc');
    expect(sections[1]!.textContent).toContain('Zeta doc');
    expect((screen.getAllByRole('button', { name: 'Map' })[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers a Project added after the app loaded when the dialog opens', async () => {
    let calls = 0;
    const { harness } = setup(async () => ({}), { projects: () => (calls += 1, calls === 1 ? [{ id: 'p1', name: 'App' }] : [{ id: 'p1', name: 'App' }, { id: 'p9', name: 'Brand new' }]) });
    harness.render(<UnassignedProjectsDialog unassigned={[{ ...item, suggestion: null }]} projects={[{ id: 'p1', name: 'App' }]} onClose={() => undefined} onChanged={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'App' })).toBeTruthy());
    fireEvent.focus(window);
    expect(await screen.findByRole('option', { name: 'Brand new' })).toBeTruthy();
  });

  it('reports a failed mapping and shows an empty state', async () => {
    const { harness } = setup(async () => {
      throw new Error('nope');
    });
    const onChanged = vi.fn();
    const view = harness.render(<UnassignedProjectsDialog unassigned={[{ ...item, suggestion: null, sampleTitles: [] }]} projects={projects} onClose={() => undefined} onChanged={onChanged} />);
    fireEvent.change(screen.getByLabelText('Your Project for Sender App'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    await waitFor(() => expect(harness.toasts.some((toast) => toast.kind === 'error' && toast.message.includes('nope'))).toBe(true));
    expect(onChanged).not.toHaveBeenCalled();
    view.unmount();
    harness.render(<UnassignedProjectsDialog unassigned={[]} projects={[]} onClose={() => undefined} onChanged={onChanged} />);
    expect(screen.getByText('Nothing to map.')).toBeTruthy();
  });
});

describe('Already mapped', () => {
  const mapping = { foreignProjectId: 'far-9', localProjectId: 'p1', docCount: 1, sampleTitles: ['Zed'], senderName: 'Nine', senderTag: null, localRegistered: true };
  const dead = { foreignProjectId: 'far-8', localProjectId: 'gone', docCount: 2, sampleTitles: [], senderName: null, senderTag: null, localRegistered: false };
  const open = (extra: Record<string, (args?: unknown) => unknown>) => {
    const { harness } = setup(async () => ({}), { listProjectMappings: () => [mapping, dead], ...extra });
    const onChanged = vi.fn();
    harness.render(<UnassignedProjectsDialog unassigned={[]} projects={projects} onClose={() => undefined} onChanged={onChanged} />);
    return { harness, onChanged };
  };

  it('lists mappings and unmaps only after confirmation', async () => {
    const calls: unknown[] = [];
    const { onChanged } = open({ unmapForeignProject: (args) => { calls.push(args); return { removed: true }; } });
    const section = await screen.findByRole('region', { name: 'Already mapped' });
    expect(within(section).getByRole('group', { name: 'Mapping Nine' }).textContent).toMatch(/“Zed”.*→ App.*“Nine”.*1 doc/);
    expect(within(section).getByRole('group', { name: 'Mapping Unnamed project' }).textContent).toMatch(/2 docs.*→ Project removed from this computer/);
    expect(section.textContent).not.toMatch(/far-/);
    fireEvent.click(within(section).getByRole('button', { name: 'Unmap Nine' }));
    expect(calls).toEqual([]);
    fireEvent.click(within(section).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Unmap Nine' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Confirm unmap' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([{ foreignProjectId: 'far-9' }]);
  });

  it('shows an error toast when unmap fails', async () => {
    const { harness, onChanged } = open({ unmapForeignProject: () => { throw new Error('boom'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Unmap Nine' }));
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
    expect(await screen.findByRole('dialog', { name: 'Map projects from other computers' })).toBeTruthy();
    // The all-projects list excludes unassigned docs so they are not also shown under Global.
    expect(calls.some((args) => (args as { excludeUnassigned?: boolean }).excludeUnassigned === true)).toBe(true);
  });
});
