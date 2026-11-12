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
    await api.listForeignProjectTitles('f');
    await api.mapForeignProject('f', 'l');
    await api.unmapForeignProject('f');
    await api.list({ unassigned: true });
    expect(call.mock.calls).toEqual([
      ['listUnassignedProjects', undefined],
      ['removedProjects', undefined],
      ['listProjectMappings', undefined],
      ['listForeignProjectTitles', { foreignProjectId: 'f' }],
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

const titlesFor = (calls: string[], map: Record<string, string[] | Error>) => ({
  listForeignProjectTitles: (args?: unknown) => {
    const id = (args as { foreignProjectId: string }).foreignProjectId;
    calls.push(id);
    const value = map[id];
    if (value instanceof Error) throw value;
    return value ?? [];
  }
});
const render = (unassigned: UnassignedProject[], h: ReturnType<typeof setup>['harness'], onChanged: () => void = () => undefined) =>
  h.render(<UnassignedProjectsDialog unassigned={unassigned} projects={projects} onClose={() => undefined} onChanged={onChanged} />);

describe('UnassignedProjectsDialog', () => {
  it('shows a Needs a Project card, never the id; preselects the suggestion but maps only on the button', async () => {
    const mapped = { foreignProjectId: 'far-1', localProjectId: 'p2', docCount: 5, sampleTitles: ['Alpha'], senderName: 'Sender App', senderTag: null, localRegistered: true };
    let done = false;
    const { harness, calls } = setup(async () => (done = true, {}), { listProjectMappings: () => (done ? [mapped] : []) });
    const onChanged = vi.fn();
    render([{ ...item, docCount: 5 }], harness, onChanged);
    const dialog = screen.getByRole('dialog', { name: 'Map projects from other computers' });
    expect(within(dialog).getByText('Needs a Project (1)')).toBeTruthy();
    const card = within(dialog).getByRole('region', { name: 'Project Sender App' });
    expect(card.textContent).toContain('5 docs · from another computer (app)');
    expect(card.textContent).toContain('Alpha · Beta · +3');
    expect(dialog.textContent).not.toContain('far-1');
    expect(dialog.textContent).not.toMatch(/Workspace/);
    const select = within(dialog).getByLabelText('Your Project for Sender App') as HTMLSelectElement;
    expect(select.value).toBe('p1');
    expect(within(dialog).getByText('Suggested · same name')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Map 5 docs to App' })).toBeTruthy();
    expect(calls).toEqual([]);
    fireEvent.change(select, { target: { value: 'p2' } });
    expect(within(dialog).queryByText(/Suggested/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Map 5 docs to Site' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([{ foreignProjectId: 'far-1', localProjectId: 'p2' }]);
    // The card leaves Needs a Project and Already mapped opens.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Project Sender App' })).toBeNull());
    expect(await screen.findByText('All synced docs are in a Project.')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Mapping Sender App' }).textContent).toContain('Site');
  });

  it('uses the singular for one doc and disables Map docs with no pick', () => {
    const { harness } = setup(async () => ({}));
    render([{ ...item, docCount: 1, suggestion: null }], harness);
    expect(screen.getByText(/1 doc · from another computer/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Map docs' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your Project for Sender App'), { target: { value: 'p2' } });
    expect(screen.getByRole('button', { name: 'Map 1 doc to Site' })).toBeTruthy();
  });

  it('maps the preselected suggestion when the button is pressed', async () => {
    const { harness, calls } = setup(async () => ({}));
    render([item], harness);
    fireEvent.click(screen.getByRole('button', { name: 'Map 2 docs to App' }));
    await waitFor(() => expect(calls).toEqual([{ foreignProjectId: 'far-1', localProjectId: 'p1' }]));
  });

  it('falls back to the first sample title when the sender has no name, and sorts by it', () => {
    const { harness } = setup(async () => ({}));
    const a = { ...item, foreignProjectId: 'far-a', senderName: null, senderTag: null, suggestion: null, sampleTitles: ['Zeta doc'] };
    const b = { ...item, foreignProjectId: 'far-b', senderName: null, senderTag: null, suggestion: null, sampleTitles: ['Alpha doc'] };
    const c = { ...item, foreignProjectId: 'far-c', senderName: null, senderTag: null, suggestion: null, sampleTitles: [] };
    render([a, b, c], harness);
    const names = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(names).toEqual(['Project Alpha doc', 'Project Unnamed project', 'Project Zeta doc']);
    expect(screen.getByLabelText('Your Project for Alpha doc')).toBeTruthy();
  });

  it('lazy-loads titles on the first Show docs, caps the list and says "and N more"', async () => {
    const loads: string[] = [];
    const many = Array.from({ length: 300 }, (_, i) => `Title ${i}`);
    const { harness } = setup(async () => ({}), titlesFor(loads, { 'far-1': many }));
    render([{ ...item, docCount: 340 }], harness);
    expect(loads).toEqual([]);
    const toggle = screen.getByRole('button', { name: 'Show docs' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    const list = await screen.findByRole('list', { name: 'Doc titles' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(201);
    expect(within(list).getByText('and 140 more')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide docs' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Hide docs' }));
    expect(screen.queryByRole('list', { name: 'Doc titles' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show docs' }));
    await screen.findByRole('list', { name: 'Doc titles' });
    expect(loads).toEqual(['far-1']);
  });

  it('omits "and N more" when every title is shown', async () => {
    const { harness } = setup(async () => ({}), titlesFor([], { 'far-1': ['Alpha', 'Beta'] }));
    render([item], harness);
    fireEvent.click(screen.getByRole('button', { name: 'Show docs' }));
    const list = await screen.findByRole('list', { name: 'Doc titles' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows a loading state, then an inline error with Retry that reloads', async () => {
    const loads: string[] = [];
    let fail = true;
    const { harness } = setup(async () => ({}), {
      listForeignProjectTitles: (args?: unknown) => {
        loads.push((args as { foreignProjectId: string }).foreignProjectId);
        if (fail) throw new Error('offline');
        return ['Alpha'];
      }
    });
    render([item], harness);
    fireEvent.click(screen.getByRole('button', { name: 'Show docs' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load titles: offline');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect((await screen.findByRole('list', { name: 'Doc titles' })).textContent).toContain('Alpha');
    expect(loads).toEqual(['far-1', 'far-1']);
  });

  it('offers a Project added after the app loaded when the dialog opens', async () => {
    let calls = 0;
    const { harness } = setup(async () => ({}), { projects: () => (calls += 1, calls === 1 ? [{ id: 'p1', name: 'App' }] : [{ id: 'p1', name: 'App' }, { id: 'p9', name: 'Brand new' }]) });
    harness.render(<UnassignedProjectsDialog unassigned={[{ ...item, suggestion: null }]} projects={[{ id: 'p1', name: 'App' }]} onClose={() => undefined} onChanged={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'App' })).toBeTruthy());
    fireEvent.focus(window);
    expect(await screen.findByRole('option', { name: 'Brand new' })).toBeTruthy();
  });

  it('reports a failed mapping and keeps the card', async () => {
    const { harness } = setup(async () => {
      throw new Error('nope');
    });
    const onChanged = vi.fn();
    render([{ ...item, suggestion: null }], harness, onChanged);
    fireEvent.change(screen.getByLabelText('Your Project for Sender App'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map 2 docs to App' }));
    await waitFor(() => expect(harness.toasts.some((toast) => toast.kind === 'error' && toast.message.includes('nope'))).toBe(true));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Project Sender App' })).toBeTruthy();
  });

  it('shows the empty state when there is nothing at all', async () => {
    const { harness } = setup(async () => ({}), { listProjectMappings: () => [] });
    render([], harness);
    expect(await screen.findByText('No docs from other computers yet.')).toBeTruthy();
    expect(screen.queryByText(/Already mapped/)).toBeNull();
  });
});

describe('stale lists, counts and caps', () => {
  const rerender = (view: { rerender(ui: React.ReactElement): void }, unassigned: UnassignedProject[]) =>
    view.rerender(<UnassignedProjectsDialog unassigned={unassigned} projects={projects} onClose={() => undefined} onChanged={() => undefined} />);

  it('never shows a negative "and N more" when more titles load than the doc count says', async () => {
    const { harness } = setup(async () => ({}), titlesFor([], { 'far-1': Array.from({ length: 250 }, (_, i) => `T${i}`) }));
    render([{ ...item, docCount: 3 }], harness);
    fireEvent.click(screen.getByRole('button', { name: 'Show docs' }));
    const list = await screen.findByRole('list', { name: 'Doc titles' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(201);
    expect(within(list).getByText('and 50 more')).toBeTruthy();
  });

  it('drops the cached titles and reloads an open list when the doc count grows', async () => {
    let batch = ['Alpha', 'Beta'];
    const loads: number[] = [];
    const { harness } = setup(async () => ({}), { listForeignProjectTitles: () => (loads.push(batch.length), batch) });
    const view = render([item], harness);
    fireEvent.click(screen.getByRole('button', { name: 'Show docs' }));
    await screen.findByRole('list', { name: 'Doc titles' });
    batch = ['Alpha', 'Beta', 'Gamma'];
    rerender(view, [{ ...item, docCount: 3 }]);
    await waitFor(() => expect(screen.getByRole('list', { name: 'Doc titles' }).textContent).toContain('Gamma'));
    expect(loads).toEqual([2, 3]);
  });

  it('refetches on next open when the doc count shrinks while collapsed', async () => {
    let batch = ['Alpha', 'Beta'];
    const loads: number[] = [];
    const { harness } = setup(async () => ({}), { listForeignProjectTitles: () => (loads.push(batch.length), batch) });
    const view = render([item], harness);
    fireEvent.click(screen.getByRole('button', { name: 'Show docs' }));
    await screen.findByRole('list', { name: 'Doc titles' });
    fireEvent.click(screen.getByRole('button', { name: 'Hide docs' }));
    batch = ['Alpha'];
    rerender(view, [{ ...item, docCount: 1 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Show docs' }));
    await waitFor(() => expect(loads).toEqual([2, 1]));
    expect((await screen.findByRole('list', { name: 'Doc titles' })).textContent).toBe('Alpha');
  });

  it('subtracts the real preview length for "+N"', () => {
    const { harness } = setup(async () => ({}));
    render([{ ...item, docCount: 4, sampleTitles: ['Only'] }, { ...item, foreignProjectId: 'far-2', senderName: 'Zed', docCount: 1, sampleTitles: ['Solo'] }], harness);
    expect(screen.getByRole('region', { name: 'Project Sender App' }).textContent).toContain('Only · +3');
    expect(screen.getByRole('region', { name: 'Project Zed' }).textContent).not.toContain('+');
  });

  it('keeps "All synced docs are in a Project." (no empty flash) after mapping the last card', async () => {
    let done = false;
    const { harness } = setup(async () => (done = true, {}), { listProjectMappings: () => [] });
    render([item], harness);
    fireEvent.click(screen.getByRole('button', { name: 'Map 2 docs to App' }));
    expect(await screen.findByText('All synced docs are in a Project.')).toBeTruthy();
    expect(done).toBe(true);
    expect(screen.queryByText('No docs from other computers yet.')).toBeNull();
  });

  it('a mapped card reappears after unmap when the parent reloads', async () => {
    const mapping = { foreignProjectId: 'far-1', localProjectId: 'p1', docCount: 2, sampleTitles: ['Alpha'], senderName: 'Sender App', senderTag: null, localRegistered: true };
    const { harness } = setup(async () => ({}), { listProjectMappings: () => [mapping], unmapForeignProject: () => ({ removed: true }) });
    const view = render([item], harness);
    fireEvent.click(await screen.findByRole('button', { name: /Already mapped/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Map 2 docs to App' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Project Sender App' })).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Unmap Sender App' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm unmap' }));
    await waitFor(() => expect(harness.toasts.some((toast) => toast.message.includes('unmapped'))).toBe(true));
    rerender(view, [item]);
    expect(await screen.findByRole('region', { name: 'Project Sender App' })).toBeTruthy();
  });

  it('shows "200+" for lists that reach the server cap', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...item, foreignProjectId: `f${i}`, senderName: `S${i}`, suggestion: null }));
    const mappings = Array.from({ length: 200 }, (_, i) => ({ foreignProjectId: `m${i}`, localProjectId: 'p1', docCount: 1, sampleTitles: ['x'], senderName: `M${i}`, senderTag: null, localRegistered: true }));
    const { harness } = setup(async () => ({}), { listProjectMappings: () => mappings });
    render(many, harness);
    expect(screen.getByText('Needs a Project (200+)')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Already mapped \(200\+\)/ })).toBeTruthy();
  });

  it('keeps Confirm unmap and Cancel inside the action column (flex-wrap, grid column sized to content)', async () => {
    const styles = (await import('./styles.js')) as unknown as { default?: string; STYLES?: string };
    const css = Object.values(styles).find((v) => typeof v === 'string' && v.includes('.dd-map-grid')) as string;
    expect(css).toMatch(/\.dd-map-grid \{[^}]*max-content/);
    expect(css).toMatch(/\.dd-map-act \{[^}]*flex-wrap: wrap/);
  });
});

describe('hostile foreign project ids', () => {
  it.each(['constructor', '__proto__', 'toString'])('renders %s as an ordinary id', async (id) => {
    const loads: string[] = [];
    const calls: unknown[] = [];
    const { harness } = setup(async (args) => (calls.push(args), {}), titlesFor(loads, { [id]: ['Alpha'] }));
    render([{ ...item, foreignProjectId: id, suggestion: null }], harness);
    const toggle = screen.getByRole('button', { name: 'Show docs' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect((screen.getByRole('button', { name: 'Map docs' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    expect((await screen.findByRole('list', { name: 'Doc titles' })).textContent).toContain('Alpha');
    expect(loads).toEqual([id]);
    fireEvent.change(screen.getByLabelText('Your Project for Sender App'), { target: { value: 'p2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map 2 docs to Site' }));
    await waitFor(() => expect(calls).toEqual([{ foreignProjectId: id, localProjectId: 'p2' }]));
  });
});

describe('Already mapped', () => {
  const mapping = { foreignProjectId: 'far-9', localProjectId: 'p1', docCount: 1, sampleTitles: ['Zed'], senderName: 'Nine', senderTag: null, localRegistered: true };
  const dead = { foreignProjectId: 'far-8', localProjectId: 'gone', docCount: 2, sampleTitles: [], senderName: null, senderTag: null, localRegistered: false };
  const other = { foreignProjectId: 'far-7', localProjectId: 'elsewhere', docCount: 3, sampleTitles: ['Moved'], senderName: 'Seven', senderTag: null, localRegistered: true };
  const open = (unassigned: UnassignedProject[], extra: Record<string, (args?: unknown) => unknown>) => {
    const { harness } = setup(async () => ({}), { listProjectMappings: () => [mapping, dead, other], ...extra });
    const onChanged = vi.fn();
    render(unassigned, harness, onChanged);
    return { harness, onChanged };
  };

  it('is collapsed while docs need a Project and expands on demand', async () => {
    open([item], {});
    const toggle = await screen.findByRole('button', { name: /Already mapped \(3\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Mapping Nine' })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('group', { name: 'Mapping Nine' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Already mapped/ }));
    expect(screen.queryByRole('group', { name: 'Mapping Nine' })).toBeNull();
  });

  it('opens by default with the all-mapped message when nothing needs a Project', async () => {
    open([], {});
    expect(await screen.findByText('All synced docs are in a Project.')).toBeTruthy();
    const nine = screen.getByRole('group', { name: 'Mapping Nine' });
    expect(nine.textContent).toMatch(/Nine.*1 doc →.*App/);
    const gone = screen.getByRole('group', { name: 'Mapping Unnamed project' });
    expect(gone.textContent).toMatch(/2 docs →.*—.*Project removed from this computer/);
    expect(screen.getByRole('group', { name: 'Mapping Seven' }).textContent).toContain('Another Project');
    expect(screen.getByRole('dialog').textContent).not.toMatch(/far-|Workspace/);
  });

  it('expands a mapped row to its titles through the lazy loader', async () => {
    const loads: string[] = [];
    open([], titlesFor(loads, { 'far-9': ['Zed', 'Zee'] }));
    const toggle = await screen.findByRole('button', { name: 'Toggle docs for Nine' });
    fireEvent.click(toggle);
    const list = await screen.findByRole('list', { name: 'Doc titles' });
    expect(list.textContent).toContain('Zee');
    expect(loads).toEqual(['far-9']);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle docs for Nine' }));
    expect(screen.queryByRole('list', { name: 'Doc titles' })).toBeNull();
  });

  it('unmaps only after inline confirmation, and Cancel restores Unmap', async () => {
    const calls: unknown[] = [];
    const { onChanged } = open([], { unmapForeignProject: (args) => { calls.push(args); return { removed: true }; } });
    const group = await screen.findByRole('group', { name: 'Mapping Nine' });
    fireEvent.click(within(group).getByRole('button', { name: 'Unmap Nine' }));
    expect(within(group).queryByRole('button', { name: 'Unmap Nine' })).toBeNull();
    expect(calls).toEqual([]);
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Unmap Nine' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm unmap' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([{ foreignProjectId: 'far-9' }]);
  });

  it('shows an error toast when unmap fails', async () => {
    const { harness, onChanged } = open([], { unmapForeignProject: () => { throw new Error('boom'); } });
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
    expect(screen.getByText('Needs a Project (1)')).toBeTruthy();
    // The all-projects list excludes unassigned docs so they are not also shown under Global.
    expect(calls.some((args) => (args as { excludeUnassigned?: boolean }).excludeUnassigned === true)).toBe(true);
  });
});
