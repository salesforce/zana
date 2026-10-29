// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { UI_USER } from '../server/rpc.js';
import type { DesignDocStore } from '../server/store.js';
import { NavPanel, ProjectTab } from './slots.js';
import { PEER_STATUS_POLL_MS } from './PeerSettings.js';
import { projectOptions } from './Workbench.js';
import { AGENT, createHarness, type Harness } from './test-harness.js';

export function seed(store: DesignDocStore, input: { title: string; projectId?: string | null; summary?: string; tags?: string[]; status?: 'draft' | 'archived' }) {
  return store.create({ template: 'blank', ...input, projectId: input.projectId ?? null }, UI_USER);
}

function openInProjectTab(harness: Harness, docId: string, projectId = 'p1') {
  localStorage.setItem(`zcc.design-docs.project-location:${projectId}`, JSON.stringify(docId));
  return harness.render(<ProjectTab pluginId="design-docs" projectId={projectId} />);
}

async function newDocDialog() {
  fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0]!);
  const dialog = screen.getByRole('dialog', { name: 'New design doc' });
  await within(dialog).findAllByRole('radio');
  return dialog;
}

function pick(filter: 'status' | 'project', option: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: `Filter by ${filter}` }));
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
}

function menuItem(name: string | RegExp) {
  return screen.getByRole('menuitem', { name });
}

describe('plugin app', () => {
  it('registers every slot and injects its stylesheet once', async () => {
    createHarness();
    const module = await import('../../app.tsx');
    const app = collectTestPluginApp(module.default, 'design-docs', 1);
    expect(app.navPanels.map((slot) => slot.id)).toEqual(['design-docs']);
    expect(app.projectTabs.map((slot) => slot.id)).toEqual(['design']);
    expect(app.projectTabs[0]!.detachable).toBe(true);
    expect(app.messageDirectives.map((slot) => slot.id)).toEqual(['design-doc']);
    expect(app.messageDirectives[0]?.hideInAssistant).toBe(true);
    expect(app.threadPanelActions.map((slot) => slot.id)).toEqual(['design-doc']);
    expect(app.messageActions.map((slot) => slot.id)).toEqual(['save-design-doc']);
    // Peers live inside the workbench, not on the host Plugins page.
    expect(app.settingsSections).toEqual([]);
    module.injectStyles();
    expect(document.querySelectorAll('#design-docs-plugin-styles')).toHaveLength(1);
    expect(document.getElementById('design-docs-plugin-styles')!.textContent).toContain('.dd-root');
  });
});

function configuredPeers(syncNow: () => Promise<{ attempted: number; synced: number; blocked: number }>, replicas = ['a', 'b']) {
  return { status: () => ({ configured: true, replicaId: 'r-a', members: replicas.map((name) => ({ replicaId: `r-${name}`, machineId: `app-${name}` })) }), syncNow } as never;
}
/** Which other computers the pairing layer reports as connected right now. */
function connectedPairing(connected: () => string[]) {
  return { connectedMembers: async () => connected(), notifyStateChanged: async () => undefined } as never;
}

describe('peers view', () => {
  it('opens Peers inside the workbench and returns to the doc list', async () => {
    const harness = createHarness();
    seed(harness.store, { title: 'Payments API', projectId: 'p1' });
    const before = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await screen.findByText('Payments API');
    const open = screen.getByRole('button', { name: 'Settings' });
    expect(open.className).toContain('dd-head-btn');
    expect(open.getAttribute('aria-pressed')).toBe('false');
    expect(open.querySelector('svg')).toBeTruthy();
    expect(open.getAttribute('title')).toBe('Design Docs settings: peers and agent');
    fireEvent.click(open);

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Peers' }).getAttribute('aria-current')).toBe('page');
    const peers = screen.getByRole('region', { name: 'Database sync peers' });
    expect(within(peers).queryByRole('link', { name: /Not listed/ })).toBeNull();
    expect(screen.queryByText('Payments API')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(before);
    expect(harness.navigateCalls).toEqual([]);

    const back = screen.getByRole('button', { name: 'Back to design docs' });
    expect(back.textContent).toContain('Design docs');
    expect(back.getAttribute('title')).toBe('Back to design docs');
    expect(back.getAttribute('aria-pressed')).toBe('true');
    const peerReads = harness.rpcCalls.filter((call) => call.method === 'peerStatus').length;
    fireEvent.click(back);
    expect(await screen.findByText('Payments API')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Database sync peers' })).toBeNull();
    // Leaving the Peers view re-reads the group, which may have changed there.
    await waitFor(() => expect(harness.rpcCalls.filter((call) => call.method === 'peerStatus').length).toBe(peerReads + 1));
  });

  it('lays settings out as header, grouped section rail and one section at a time', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Manage Design Docs sync, agents and publishing preferences.')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect([...nav.querySelectorAll('.dd-nav-group-label')].map((el) => el.textContent)).toEqual(['SYNC', 'AGENTS']);
    expect([...nav.querySelectorAll('button')].map((el) => el.textContent)).toEqual(['Peers', 'Agent']);
    expect(nav.querySelectorAll('button svg')).toHaveLength(2);
    // Default section: only Peers renders, under its own heading and description.
    expect(screen.getByRole('heading', { name: 'Peers' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Database sync peers' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Agent harness' })).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: 'Agent' }));
    expect(screen.queryByRole('region', { name: 'Database sync peers' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Agent harness' })).toBeTruthy();
  });

  it('falls back to Peers when the remembered section no longer exists', async () => {
    localStorage.setItem('zcc.design-docs.settings-tab', JSON.stringify('bogus'));
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Peers' }).getAttribute('aria-current')).toBe('page');
  });

  it('keeps project tab header actions in the Peers view', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" headerActions={<button type="button">Split</button>} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Split' })).toBeTruthy();
  });

  it('shows the syncing count on Sync, not on the plain Settings icon', async () => {
    const harness = createHarness({ peerSync: configuredPeers(async () => ({ attempted: 0, synced: 0, blocked: 0 }), ['a', 'b', 'c']), pairing: connectedPairing(() => ['app-b']) });
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    const sync = await screen.findByRole('button', { name: 'Sync' });
    expect(sync.textContent).toBe('2');
    expect(sync.getAttribute('title')).toBe('2 computers syncing (including this one)');
    const settings = screen.getByRole('button', { name: 'Settings' });
    expect(settings.textContent).toBe('');
    expect(settings.className).toContain('dd-head-icon');
    expect(settings.getAttribute('title')).toBe('Design Docs settings: peers and agent');
  });

  it('hides Sync until a remote peer is connected, then counts every connected computer', async () => {
    let connected: string[] = [];
    const harness = createHarness({ peerSync: configuredPeers(async () => ({ attempted: 0, synced: 0, blocked: 0 }), ['a', 'b', 'c']), pairing: connectedPairing(() => connected) });
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull());
    connected = ['app-b', 'app-c'];
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to design docs' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync' }).textContent).toBe('3'));
  });

  it('re-reads who is connected on a timer and keeps the last count when a re-read fails', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      let connected = ['app-b'];
      const harness = createHarness({ peerSync: configuredPeers(async () => ({ attempted: 0, synced: 0, blocked: 0 })), pairing: connectedPairing(() => connected) });
      harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
      expect((await screen.findByRole('button', { name: 'Sync' })).textContent).toBe('2');
      connected = [];
      await act(async () => { vi.advanceTimersByTime(PEER_STATUS_POLL_MS); });
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull());
      harness.fail('peerStatus', 'offline');
      await act(async () => { vi.advanceTimersByTime(PEER_STATUS_POLL_MS); });
      expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('syncs from the doc list header', async () => {
    let finish!: (value: { attempted: number; synced: number; blocked: number }) => void;
    const syncNow = vi.fn(() => new Promise<{ attempted: number; synced: number; blocked: number }>((resolve) => { finish = resolve; }));
    const harness = createHarness({ peerSync: configuredPeers(syncNow), pairing: connectedPairing(() => ['app-b']) });
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    const sync = await screen.findByRole('button', { name: 'Sync' });
    expect(sync.getAttribute('title')).toBe('2 computers syncing (including this one)');
    fireEvent.click(sync);
    expect((screen.getByRole('button', { name: 'Syncing' }) as HTMLButtonElement).disabled).toBe(true);
    finish({ attempted: 2, synced: 2, blocked: 0 });
    await screen.findByRole('button', { name: 'Sync' });
    expect(harness.toasts.at(-1)).toEqual({ message: 'Synced 2 peers', kind: 'info' });
    expect(syncNow).toHaveBeenCalledOnce();
  });

  it('syncs from the collapsed doc list, without a Peers entry there', async () => {
    let finish!: (value: { attempted: number; synced: number; blocked: number }) => void;
    const syncNow = vi.fn(() => new Promise<{ attempted: number; synced: number; blocked: number }>((resolve) => { finish = resolve; }));
    const harness = createHarness({ peerSync: configuredPeers(syncNow), pairing: connectedPairing(() => ['app-b']) });
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await screen.findByRole('button', { name: 'Sync' });
    fireEvent.click(screen.getByRole('button', { name: 'Hide doc list' }));
    const rail = screen.getByRole('navigation', { name: 'Design docs' });
    expect(within(rail).queryByRole('button', { name: 'Settings' })).toBeNull();
    const sync = within(rail).getByRole('button', { name: 'Sync peers: 2 computers syncing (including this one)' }) as HTMLButtonElement;
    fireEvent.click(sync);
    const busy = within(rail).getByRole('button', { name: 'Syncing peers: 2 computers syncing (including this one)' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    // A second press while syncing is ignored.
    fireEvent.click(busy);
    finish({ attempted: 3, synced: 2, blocked: 1 });
    await within(rail).findByRole('button', { name: /^Sync peers/ });
    expect(harness.toasts.at(-1)).toEqual({ message: 'Synced 2/3; 1 blocked', kind: 'info' });
    expect(syncNow).toHaveBeenCalledOnce();
  });

  it('reports a failed sync and hides Sync until a group is configured', async () => {
    const harness = createHarness({ peerSync: configuredPeers(async () => { throw new Error('peer offline'); }), pairing: connectedPairing(() => ['app-b']) });
    const view = harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(harness.toasts.at(-1)).toEqual({ message: 'peer offline', kind: 'error' }));
    view.unmount();

    const bare = createHarness();
    bare.fail('peerStatus', 'unavailable');
    bare.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    expect(await screen.findByRole('button', { name: 'Settings' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide doc list' }));
    expect(screen.queryByRole('button', { name: /Sync/ })).toBeNull();
  });
});

describe('creating docs', () => {
  it('manages templates on the landing page: filter, per-card actions, editor and back', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    expect(await screen.findByText('Start from a template')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Templates' })).toBeNull();
    expect(screen.getByRole('button', { name: /New template/ }).className).toContain('primary');
    const filter = screen.getByRole('textbox', { name: 'Filter templates' });
    fireEvent.change(filter, { target: { value: 'decision record' } });
    expect(await screen.findByText('Decision record')).toBeTruthy();
    expect(screen.queryByText('Product spec')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Decision record' }));
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Export' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Back to templates' }));
    expect(await screen.findByText('Start from a template')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to templates' })).toBeNull();
  });

  it('runs template actions from the landing page: duplicate, export, delete, import, export all, restore', async () => {
    const names: string[] = [];
    const urls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: () => 'blob:t', revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    try {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    expect(await screen.findByText('Start from a template')).toBeTruthy();
    const count = () => harness.store.listTemplates().length;
    const before = count();
    const act1 = async (card: string, item: string) => {
      fireEvent.click(await screen.findByRole('button', { name: `Actions for ${card}` }));
      fireEvent.click(screen.getByRole('menuitem', { name: item }));
    };
    await act1('Decision record', 'Duplicate');
    await waitFor(() => expect(count()).toBe(before + 1));
    expect(await screen.findByText('Decision record (copy)')).toBeTruthy();
    await act1('Decision record', 'Export');
    await waitFor(() => expect(names).toContain('adr.design-doc-templates.json'));
    await act1('Decision record (copy)', 'Delete');
    await waitFor(() => expect(count()).toBe(before));

    fireEvent.click(screen.getByRole('button', { name: 'Template actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export all' }));
    await waitFor(() => expect(names).toContain('design-doc-templates.json'));

    harness.store.templateDelete('adr');
    fireEvent.click(screen.getByRole('button', { name: 'Template actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore built-ins' }));
    await waitFor(() => expect(harness.store.templateByKey('adr')).not.toBeNull());

    const bundle = harness.store.templatesExport(['blank']);
    const upload = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([bundle], 'bundle.json', { type: 'application/json' });
    fireEvent.change(upload, { target: { files: [file] } });
    await waitFor(() => expect(count()).toBe(before + 1));
    fireEvent.change(upload, { target: { files: [] } });
    fireEvent.change(upload, { target: { files: [new File(['not json'], 'bad.json')] } });
    await waitFor(() => expect(harness.toasts.some((toast) => toast.message.startsWith('Could not import templates'))).toBe(true));
    } finally {
      click.mockRestore();
      Object.assign(URL, urls);
    }
  });

  it('disables Delete on the last remaining template', async () => {
    const harness = createHarness();
    for (const template of harness.store.listTemplates().slice(1)) harness.store.templateDelete(template.id);
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    const only = harness.store.listTemplates()[0]!;
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${only.label}` }));
    expect(screen.getByRole('menuitem', { name: 'Delete' }).hasAttribute('disabled') || screen.getByRole('menuitem', { name: 'Delete' }).getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('reports failed template actions with a toast', async () => {
    const boom = async () => { throw new Error('boom'); };
    const harness = createHarness({ rpcOverrides: { templateDuplicate: boom, templateNew: boom, templatesExport: boom, templatesRestoreBuiltins: boom } });
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Decision record' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(harness.toasts.some((toast) => toast.message.startsWith('Could not duplicate template'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /New template/ }));
    await waitFor(() => expect(harness.toasts.some((toast) => toast.message.startsWith('Could not create template'))).toBe(true));
    for (const [item, text] of [['Export all', 'Could not export templates'], ['Restore built-ins', 'Could not restore built-ins']] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'Template actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: item }));
      await waitFor(() => expect(harness.toasts.some((toast) => toast.message.startsWith(text))).toBe(true));
    }
  });

  it('Home returns from a template editor to the landing page', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: /New template/ }));
    expect(await screen.findByRole('button', { name: 'Back to templates' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(await screen.findByText('Design docs your agents work on with you')).toBeTruthy();
  });

  it('starts on the landing page and creates a doc from a template', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    expect(await screen.findByText('Design docs your agents work on with you')).toBeTruthy();
    expect(await screen.findByText('No design docs yet.')).toBeTruthy();

    const landing = screen.getByText('Start from a template').closest('.dd-landing-start') as HTMLElement;
    fireEvent.click(await within(landing).findByRole('button', { name: /^Decision record/ }));
    const dialog = screen.getByRole('dialog', { name: 'New design doc' });
    expect((await within(dialog).findByRole('radio', { name: /Decision record/ })).getAttribute('aria-checked')).toBe('true');
    const create = within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Use SQLite' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/One line agents see/), { target: { value: 'Storage choice' } });
    fireEvent.change(within(dialog).getByPlaceholderText('sync, mobile'), { target: { value: 'Storage, , DB' } });
    fireEvent.click(create);

    expect(await screen.findByRole('button', { name: 'Use SQLite' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'New design doc' })).toBeNull();
    const [doc] = harness.store.list({});
    expect(doc).toMatchObject({ title: 'Use SQLite', summary: 'Storage choice', projectId: 'p1', tags: ['storage', 'db'] });
    expect(harness.store.get(doc!.id).files.map((file) => file.path)).toEqual(['README.md']);
    expect(await screen.findByRole('navigation', { name: 'Files' })).toBeTruthy();
    expect(localStorage.getItem('zcc.design-docs.project-location:p1')).toBe(JSON.stringify(doc!.id));
  });

  it('creates a doc and starts an agent drafting it from the brief', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p2" />);
    const dialog = await newDocDialog();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Product spec/ }));
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Offline sync' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Describe the problem/), { target: { value: 'Phones lose signal in tunnels.' } });
    expect(within(dialog).getByText('An agent drafts it from the brief.')).toBeTruthy();
    // Enter in a field submits the form too.
    fireEvent.submit(dialog.querySelector('form')!);

    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    const [spawned] = harness.spawn.mock.calls[0] as unknown as [{ projectId: string; prompt: string; harness?: string; providerId?: string; pluginMetadata: { designDocId: string } }];
    expect(spawned.projectId).toBe('p2');
    // The default Agent setting follows the project's AI harness; it never picks a provider itself.
    expect(spawned.harness).toBe('project-default');
    expect(spawned).not.toHaveProperty('providerId');
    expect(spawned.prompt).toContain('Phones lose signal in tunnels.');
    const doc = harness.store.list({})[0]!;
    expect(spawned.pluginMetadata.designDocId).toBe(doc.id);
    // Without a side panel composer, the thread starts here and the doc opens beside it.
    expect(harness.navigateCalls).toEqual([
      { method: 'openPanelAgent', options: { draft: { prompt: spawned.prompt, view: doc.id, projectId: 'p2' }, title: 'Offline sync' } },
      { method: 'openPanelAgent', options: { threadId: 'thread-1', title: 'Offline sync' } },
      { method: 'openThreadPanel', options: { actionId: 'design-doc', title: 'Offline sync', params: { docId: doc.id }, threadId: 'thread-1' } },
      { method: 'toThread', threadId: 'thread-1' }
    ]);
    expect(harness.toasts.at(-1)!.message).toContain('An agent is drafting “Offline sync”');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New design doc' })).toBeNull());
  });

  it('creates a global doc without drafting when there is no project to run in', async () => {
    const harness = createHarness({ projects: [] });
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);
    const dialog = await newDocDialog();
    expect(within(dialog).getByRole('option', { name: 'Global (all projects)' })).toBeTruthy();
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Shared glossary' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Describe the problem/), { target: { value: 'Terms' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create & draft with agent' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Doc created. Add a project to let an agent draft it.', kind: 'error' }));
    expect(harness.spawn).not.toHaveBeenCalled();
    const doc = harness.store.list({})[0]!;
    expect(doc.projectId).toBeNull();
    expect(harness.navigateCalls).toEqual([{ method: 'toPluginPanel', path: 'design-docs', options: { subPath: doc.id } }]);
  });

  it('says the doc was created when only the drafting agent fails to start', async () => {
    const harness = createHarness();
    harness.spawn.mockRejectedValueOnce(
      new Error('No usable AI harness: Default harness unavailable. Choose an installed, enabled harness in Settings → AI Harness.')
    );
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    const dialog = await newDocDialog();
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Tunnels' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Describe the problem/), { target: { value: 'Signal drops.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create & draft with agent' }));
    await waitFor(() => expect(harness.toasts.at(-1)).toEqual({
      message: 'Doc created, but the agent could not start: No usable AI harness: Default harness unavailable. '
        + 'Choose an installed, enabled harness in Settings → AI Harness.',
      kind: 'error'
    }));
    expect(harness.toasts.some((toast) => toast.message.startsWith('Could not create the doc'))).toBe(false);
    expect(harness.store.list({}).map((doc) => doc.title)).toEqual(['Tunnels']);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New design doc' })).toBeNull());
  });

  it('drafts a global doc in the Default Project rather than the first project', async () => {
    const harness = createHarness({ projects: [{ id: 'p1', name: 'App' }, { id: 'quick', name: 'Default Project', quickAgent: true }] });
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);
    const dialog = await newDocDialog();
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Glossary' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Describe the problem/), { target: { value: 'Terms' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create & draft with agent' }));
    await waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    expect((harness.spawn.mock.calls[0] as unknown as [{ projectId: string }])[0].projectId).toBe('quick');
  });

  it('keeps the dialog open when creating fails, and closes on Cancel', async () => {
    const harness = createHarness();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    const dialog = await newDocDialog();
    harness.fail('create', 'disk full');
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. Offline sync for the mobile app'), { target: { value: 'Nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not create the doc: disk full', kind: 'error' }));
    expect(screen.getByRole('dialog', { name: 'New design doc' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'New design doc' })).toBeNull();
  });
});

describe('doc list', () => {
  it("lists a project's docs plus global ones, and searches and filters them", async () => {
    const harness = createHarness();
    seed(harness.store, { title: 'Payments API', projectId: 'p1', summary: 'Charge flow', tags: ['billing'] });
    seed(harness.store, { title: 'Glossary', projectId: null });
    seed(harness.store, { title: 'Marketing site', projectId: 'p2' });
    seed(harness.store, { title: 'Old idea', projectId: 'p1', status: 'archived' });
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);

    expect(await screen.findByText('Payments API')).toBeTruthy();
    // The summary moved to the row's tooltip.
    expect(screen.getByText('Payments API').closest('button')!.getAttribute('title')).toBe('Payments API\nCharge flow');
    expect(screen.getByText('Glossary')).toBeTruthy();
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.queryByText('Marketing site')).toBeNull();
    expect(screen.queryByText('Old idea')).toBeNull();

    const search = screen.getByRole('textbox', { name: 'Search design docs' });
    fireEvent.change(search, { target: { value: 'zzz-nothing' } });
    expect(await screen.findByText('No docs match.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Payments API')).toBeTruthy();

    const statusPicker = screen.getByRole('button', { name: 'Filter by status' });
    expect(statusPicker.textContent).toBe('Active');
    expect(screen.queryByRole('button', { name: 'Filter by project' })).toBeNull();
    pick('status', 'Archived');
    expect(await screen.findByText('Old idea')).toBeTruthy();
    expect(screen.queryByText('Payments API')).toBeNull();
    expect(statusPicker.textContent).toBe('Archived');
    expect(statusPicker.classList.contains('on')).toBe(true);
    pick('status', 'All statuses');
    expect(await screen.findByText('Payments API')).toBeTruthy();
    expect(screen.getByText('Old idea')).toBeTruthy();
    expect(localStorage.getItem('zcc.design-docs.list-status')).toBe('"all"');

    fireEvent.click(screen.getByText('Payments API'));
    expect(await screen.findByTitle('Edit title')).toBeTruthy();
    expect(screen.getByText('Payments API', { selector: '.dd-doc-row-title' }).closest('button')!.getAttribute('aria-current')).toBe('page');
  });

  it('opens a menu of doc actions on right click', async () => {
    const harness = createHarness();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const open = seed(harness.store, { title: 'Payments API', projectId: 'p1' });
    const other = seed(harness.store, { title: 'Glossary', projectId: 'p1' });
    const spare = seed(harness.store, { title: 'Scratch', projectId: 'p1' });
    openInProjectTab(harness, open.id);
    await screen.findByTitle('Edit title');
    const row = (title: string) => screen.getByText(title, { selector: '.dd-doc-row-title' }).closest('button')!;
    const rightClick = (title: string) => fireEvent.contextMenu(row(title), { clientX: 40, clientY: 60 });

    // The open doc offers no Open; the menu marks its row and takes focus.
    rightClick('Payments API');
    const menu = screen.getByRole('menu', { name: 'Actions for Payments API' });
    expect(within(menu).queryByRole('menuitem', { name: 'Open' })).toBeNull();
    expect(row('Payments API').classList.contains('dd-doc-row-menu')).toBe(true);
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);
    fireEvent.click(menuItem(/Copy chat reference/));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`::design-doc{id="${open.id}"}`));
    expect(screen.queryByRole('menu')).toBeNull();

    rightClick('Glossary');
    fireEvent.click(menuItem('Archive'));
    await waitFor(() => expect(harness.store.get(other.id).status).toBe('archived'));
    expect(screen.getByTitle('Edit title').textContent).toBe('Payments API');

    // Deleting another doc keeps the open one; deleting the open one leaves it.
    rightClick('Scratch');
    fireEvent.click(menuItem('Delete…'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete design doc' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(harness.store.find(spare.id)).toBeNull());
    expect(screen.getByTitle('Edit title').textContent).toBe('Payments API');

    await waitFor(() => expect(screen.queryByText('Glossary', { selector: '.dd-doc-row-title' })).toBeNull());
    const extra = seed(harness.store, { title: 'Later', projectId: 'p1' });
    harness.emit({ docId: extra.id });
    await screen.findByText('Later', { selector: '.dd-doc-row-title' });
    rightClick('Later');
    fireEvent.click(menuItem('Open'));
    await waitFor(() => expect(screen.getByTitle('Edit title').textContent).toBe('Later'));

    rightClick('Later');
    fireEvent.click(menuItem('Move to project…'));
    fireEvent.change(within(screen.getByRole('dialog', { name: 'Move design doc' })).getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Move design doc' })).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(harness.store.get(extra.id).projectId).toBeNull());

    rightClick('Later');
    fireEvent.click(menuItem('Delete…'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete design doc' })).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Design docs your agents work on with you')).toBeTruthy();
  });

  it('downloads a doc as a zip from the right-click menu and the header menu', async () => {
    const harness = createHarness();
    const blobs: Blob[] = [];
    const saved: string[] = [];
    const urls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: (blob: Blob) => (blobs.push(blob), 'blob:zip'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    try {
      const doc = seed(harness.store, { title: 'Payments API', projectId: 'p1' });
      openInProjectTab(harness, doc.id);
      await screen.findByTitle('Edit title');

      fireEvent.contextMenu(screen.getByText('Payments API', { selector: '.dd-doc-row-title' }).closest('button')!);
      fireEvent.click(menuItem(/Download \.zip/));
      await waitFor(() => expect(saved).toEqual([`${doc.slug}.zip`]));
      expect(blobs[0]!.type).toBe('application/zip');
      const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
      expect(new TextDecoder().decode(bytes)).toContain(`${doc.slug}/README.md`);

      harness.fail('siteFiles', 'disk on fire');
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(menuItem(/Download \.zip/));
      await waitFor(() => expect(harness.toasts.at(-1)).toEqual({ message: 'Could not download the doc: disk on fire', kind: 'error' }));
      expect(saved).toHaveLength(1);
    } finally {
      click.mockRestore();
      Object.assign(URL, urls);
    }
  });

  it('shows every project in the nav panel with a project filter, and navigates by URL', async () => {
    const harness = createHarness();
    const payments = seed(harness.store, { title: 'Payments API', projectId: 'p1' });
    seed(harness.store, { title: 'Glossary', projectId: null });
    seed(harness.store, { title: 'Orphan', projectId: 'gone' });
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);

    expect(await screen.findByText('Payments API')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('App')).toBeTruthy());
    expect(screen.getByText('Unknown project')).toBeTruthy();
    expect(screen.getByText('Global')).toBeTruthy();

    // Only projects with docs are offered, each with its count.
    fireEvent.click(screen.getByRole('button', { name: 'Filter by project' }));
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['All projects3', 'Global docs1', 'App1']);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(options[1]!);
    await waitFor(() => expect(screen.queryByText('Payments API')).toBeNull());
    expect(screen.getByText('Glossary')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter by project' }).textContent).toBe('Global docs');
    pick('project', /^App/);
    expect(await screen.findByText('Payments API')).toBeTruthy();
    expect(screen.queryByText('Glossary')).toBeNull();
    pick('project', /^All projects/);

    fireEvent.click(screen.getByText('Payments API'));
    expect(harness.navigateCalls.at(-1)).toEqual({ method: 'toPluginPanel', path: 'design-docs', options: { subPath: payments.id } });
  });

  it('opens the doc and file named in the nav sub-path', async () => {
    const harness = createHarness();
    const doc = harness.store.create(
      { title: 'Search', files: [{ path: 'README.md', content: 'Intro' }, { path: 'api.md', content: 'Endpoints' }] },
      UI_USER
    );
    harness.render(<NavPanel pluginId="design-docs" subPath={`${doc.id}/api.md`} />);
    expect(await screen.findByText('Endpoints')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /README\.md/ }));
    expect(harness.navigateCalls.at(-1)).toEqual({
      method: 'toPluginPanel',
      path: 'design-docs',
      options: { subPath: `${doc.id}/README.md`, replace: true }
    });
  });

  it('keeps the picked project offered when it has no docs left', () => {
    const projects = [
      { id: 'p1', name: 'App' },
      { id: 'p2', name: 'Site' }
    ];
    const labels = (selected: string) => projectOptions([], projects, selected).map((option) => option.label);
    expect(labels('')).toEqual(['All projects']);
    expect(labels('p2')).toEqual(['All projects', 'Site']);
    expect(labels('__global__')).toEqual(['All projects', 'Global docs']);
  });

  it('shows list errors', async () => {
    const harness = createHarness();
    harness.fail('list', 'database locked');
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    expect(await screen.findByText('database locked')).toBeTruthy();
  });

  it('collapses to a rail and remembers it', async () => {
    const harness = createHarness();
    seed(harness.store, { title: 'Payments API', projectId: 'p1' });
    const glossary = seed(harness.store, { title: 'Glossary', projectId: null });
    await harness.asAgent((store) => store.writeFile(glossary.id, { path: 'README.md', content: 'Terms' }, AGENT));
    const view = harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);

    await screen.findByText('Payments API');
    expect(screen.getByTitle('2 docs').textContent).toBe('2');
    expect(screen.getByTitle('Global').textContent).toBe('Global');
    // Agent edits from before tracking started are not flagged as new.
    expect(screen.queryByText('New edits')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search design docs'), { target: { value: 'Payments' } });
    expect(await screen.findByTitle('1 doc')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide doc list' }));
    expect(screen.queryByText('Payments API')).toBeNull();
    expect(localStorage.getItem('zcc.design-docs.list-open')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'New design doc' }));
    expect(screen.getByRole('dialog', { name: 'New design doc' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    view.unmount();
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show doc list' }));
    expect(await screen.findByText('Payments API')).toBeTruthy();
    expect(localStorage.getItem('zcc.design-docs.list-open')).toBe('true');
  });
});

describe('doc header', () => {
  it('edits the title and summary in place', async () => {
    const harness = createHarness();
    const doc = seed(harness.store, { title: 'Draft', projectId: 'p1' });
    openInProjectTab(harness, doc.id);

    fireEvent.click(await screen.findByTitle('Edit title'));
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Event bus' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(await screen.findByTitle('Edit title')).toBeTruthy();
    await waitFor(() => expect(harness.store.get(doc.id).title).toBe('Event bus'));
    await waitFor(() => expect(screen.getByTitle('Edit title').textContent).toBe('Event bus'));

    fireEvent.click(screen.getByTitle('Edit title'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Discarded' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Escape' });
    expect(screen.getByTitle('Edit title').textContent).toBe('Event bus');

    fireEvent.click(screen.getByTitle('Edit summary'));
    const summary = screen.getByRole('textbox', { name: 'Summary' });
    fireEvent.change(summary, { target: { value: 'Pub/sub for services' } });
    fireEvent.blur(summary);
    await waitFor(() => expect(harness.store.get(doc.id).summary).toBe('Pub/sub for services'));

    harness.fail('update', 'read-only');
    fireEvent.click(await screen.findByTitle('Edit title'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Rejected' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Enter' });
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not update the doc: read-only', kind: 'error' }));
    await waitFor(() => expect(screen.getByTitle('Edit title').textContent).toBe('Event bus'));
  });

  it('changes status and tags', async () => {
    const harness = createHarness();
    const doc = seed(harness.store, { title: 'Tagged', projectId: 'p1', tags: ['old'] });
    openInProjectTab(harness, doc.id);

    fireEvent.click(await screen.findByTitle('Change status'));
    fireEvent.click(menuItem('In review'));
    await waitFor(() => expect(harness.store.get(doc.id).status).toBe('review'));

    fireEvent.click(screen.getByRole('button', { name: 'Tag' }));
    const input = screen.getByRole('textbox', { name: 'Add tags' });
    fireEvent.change(input, { target: { value: 'Alpha, old, beta' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(harness.store.get(doc.id).tags).toEqual(['old', 'alpha', 'beta']));
    // Wait for the refreshed tags before removing one, or the click acts on stale ones.
    await screen.findByRole('button', { name: 'Remove tag beta' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove tag old' }));
    await waitFor(() => expect(harness.store.get(doc.id).tags).toEqual(['alpha', 'beta']));

    fireEvent.click(await screen.findByRole('button', { name: 'Tag' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Add tags' }), { target: { value: 'ignored' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Add tags' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Add tags' })).toBeNull();
    expect(harness.store.get(doc.id).tags).toEqual(['alpha', 'beta']);
  });

  it('archives, moves, copies references and deletes from the actions menu', async () => {
    const harness = createHarness();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const doc = seed(harness.store, { title: 'Lifecycle', projectId: 'p1' });
    openInProjectTab(harness, doc.id);
    await screen.findByTitle('Edit title');
    const more = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    more();
    fireEvent.click(menuItem(/Copy chat reference/));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`::design-doc{id="${doc.id}"}`));
    expect(harness.toasts.at(-1)).toEqual({ message: 'Copied reference', kind: 'info' });
    writeText.mockRejectedValueOnce(new Error('denied'));
    more();
    fireEvent.click(menuItem(/Copy id/));
    await waitFor(() => expect(harness.toasts.at(-1)).toEqual({ message: 'Could not copy id', kind: 'error' }));

    more();
    fireEvent.click(menuItem('Archive'));
    await waitFor(() => expect(harness.store.get(doc.id).status).toBe('archived'));
    await waitFor(() => expect(screen.getByTitle('Change status').textContent).toBe('Archived'));
    more();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unarchive' }));
    await waitFor(() => expect(harness.store.get(doc.id).status).toBe('draft'));
    await waitFor(() => expect(screen.getByTitle('Change status').textContent).toBe('Draft'));

    more();
    fireEvent.click(menuItem('Move to project…'));
    const move = screen.getByRole('dialog', { name: 'Move design doc' });
    const moveButton = within(move).getByRole('button', { name: 'Move' }) as HTMLButtonElement;
    expect(moveButton.disabled).toBe(true);
    fireEvent.change(within(move).getByRole('combobox'), { target: { value: '' } });
    fireEvent.click(moveButton);
    await waitFor(() => expect(harness.store.get(doc.id).projectId).toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move design doc' })).toBeNull());

    more();
    fireEvent.click(menuItem('Delete…'));
    const confirm = screen.getByRole('dialog', { name: 'Delete design doc' });
    expect(confirm.textContent).toContain('with its 1 file');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Design docs your agents work on with you')).toBeTruthy();
    expect(harness.store.find(doc.id)).toBeNull();
    expect(harness.toasts.at(-1)).toEqual({ message: 'Deleted “Lifecycle”', kind: 'info' });
  });

  it('says a delete also reaches paired computers only while in a sync group', async () => {
    for (const configured of [true, false]) {
      const harness = createHarness({ rpcOverrides: { peerStatus: async () => ({ configured, members: [] }) } });
      const doc = seed(harness.store, { title: `Synced ${configured}`, projectId: 'p1' });
      const view = openInProjectTab(harness, doc.id);
      await screen.findByTitle('Edit title');
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(menuItem('Delete…'));
      const confirm = screen.getByRole('dialog', { name: 'Delete design doc' });
      if (configured) await waitFor(() => expect(confirm.textContent).toContain('It will also be deleted on your paired computers.'));
      else {
        await waitFor(() => expect(harness.rpcCalls.some((call) => call.method === 'peerStatus')).toBe(true));
        expect(confirm.textContent).not.toContain('paired computers');
      }
      expect(confirm.textContent).toContain('This cannot be undone');
      fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(harness.store.find(doc.id)).toBeNull());
      view.unmount();
    }
  });

  it('keeps the delete confirm usable, with a conservative propagation warning, when sync status cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = createHarness({ rpcOverrides: { peerStatus: async () => { throw new Error('offline'); } } });
    const doc = seed(harness.store, { title: 'No status', projectId: 'p1' });
    openInProjectTab(harness, doc.id);
    await screen.findByTitle('Edit title');
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(menuItem('Delete…'));
    const confirm = screen.getByRole('dialog', { name: 'Delete design doc' });
    await waitFor(() => expect(harness.rpcCalls.some((call) => call.method === 'peerStatus')).toBe(true));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(confirm.textContent).toContain('If this computer is paired with others, it will also be deleted on them.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(harness.store.find(doc.id)).toBeNull());
    warn.mockRestore();
  });

  it('reports a failed delete and keeps the doc', async () => {
    const harness = createHarness();
    const doc = seed(harness.store, { title: 'Sticky', projectId: 'p1' });
    openInProjectTab(harness, doc.id);
    await screen.findByTitle('Edit title');
    harness.fail('remove', 'locked');
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(menuItem('Delete…'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete design doc' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'Could not delete: locked', kind: 'error' }));
    expect(harness.store.find(doc.id)).not.toBeNull();
    expect(screen.getByTitle('Edit title')).toBeTruthy();
  });
});

describe('doc list sections', () => {
  const row = (title: string) => screen.getByText(title, { selector: '.dd-doc-row-title' }).closest('button')!;
  const rightClick = (title: string) => fireEvent.contextMenu(row(title), { clientX: 40, clientY: 60 });
  const sectionNames = () => screen.queryAllByRole('region').map((region) => region.getAttribute('aria-label'));
  const titlesIn = (label: string) =>
    within(screen.getByRole('region', { name: label }))
      .queryAllByText(/./, { selector: '.dd-doc-row-title' })
      .map((title) => title.textContent);

  it('groups the nav panel by project, collapses sections, and switches to one timeline', async () => {
    const harness = createHarness();
    seed(harness.store, { title: 'Glossary', projectId: null });
    seed(harness.store, { title: 'Payments API', projectId: 'p1' });
    seed(harness.store, { title: 'Landing page', projectId: 'p2' });
    seed(harness.store, { title: 'Checkout', projectId: 'p1' });
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);

    // Same-millisecond seeds have no reliable recency order; buildSections' tests cover it.
    await waitFor(() => expect(sectionNames().sort()).toEqual(['App', 'Global', 'Site']));
    expect(titlesIn('App').sort()).toEqual(['Checkout', 'Payments API']);
    // Rows inside a project section drop the project name.
    expect(within(row('Checkout')).queryByText('App')).toBeNull();

    const head = (label: string) => within(screen.getByRole('region', { name: label })).getByRole('button', { name: new RegExp(label) });
    const appHead = head('App');
    expect(appHead.getAttribute('aria-expanded')).toBe('true');
    expect(appHead.textContent).toContain('2');
    fireEvent.click(appHead);
    expect(appHead.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Checkout')).toBeNull();
    expect(JSON.parse(JSON.parse(localStorage.getItem('zcc.design-docs.list-collapsed')!))).toEqual(['project:p1']);
    // A search shows matches inside collapsed sections.
    fireEvent.change(screen.getByLabelText('Search design docs'), { target: { value: 'Checkout' } });
    expect(await screen.findByText('Checkout')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search design docs'), { target: { value: '' } });
    // A new query remounts the list, so wait for it and look the header up again.
    await waitFor(() => expect(sectionNames().sort()).toEqual(['App', 'Global', 'Site']));
    expect(screen.queryByText('Checkout')).toBeNull();
    fireEvent.click(head('App'));
    expect(await screen.findByText('Checkout')).toBeTruthy();

    // Flat: the original single list with project names, no section headers.
    fireEvent.click(screen.getByRole('button', { name: 'Group by project' }));
    expect(localStorage.getItem('zcc.design-docs.list-grouped')).toBe('false');
    await waitFor(() => expect(sectionNames()).toEqual([]));
    expect(within(row('Checkout')).getByText('App')).toBeTruthy();

    // Filtering to one project hides the grouping toggle.
    pick('project', /^Site/);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Group by project' })).toBeNull());
  });

  it('lists the current project first in the nav panel', async () => {
    const harness = createHarness({ context: { projectId: 'p2' } });
    seed(harness.store, { title: 'Landing page', projectId: 'p2' });
    seed(harness.store, { title: 'Checkout', projectId: 'p1' });
    harness.render(<NavPanel pluginId="design-docs" subPath="" />);

    await waitFor(() => expect(sectionNames()).toEqual(['Site', 'App']));
    expect(within(screen.getByRole('region', { name: 'Site' })).getByText('Here')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'App' })).queryByText('Here')).toBeNull();
  });

  it('quotes the waiting comment, hides Draft, and flags agent edits until the doc is opened', async () => {
    localStorage.setItem('zcc.design-docs.list-seen', JSON.stringify(JSON.stringify({ since: 0, docs: {} })));
    const harness = createHarness();
    const plan = seed(harness.store, { title: 'Plan', projectId: 'p1' });
    seed(harness.store, { title: 'Glossary', projectId: null });
    const review = seed(harness.store, { title: 'Onboarding', projectId: 'p1' });
    await harness.asAgent((store) => store.update(plan.id, { status: 'review' }, AGENT));
    await harness.asAgent((store) => store.addComment(review.id, { body: 'Which\n  numbers?' }, AGENT));
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);

    await waitFor(() => expect(sectionNames()).toEqual(['Needs me', 'Recent']));
    const excerpt = row('Onboarding').querySelector('.dd-doc-row-excerpt')!;
    expect(excerpt.querySelector('.dd-doc-row-excerpt-body')!.textContent).toBe('Which numbers?');
    expect(excerpt.querySelector('.dd-doc-row-excerpt-author')!.textContent).toBe('Architect');
    // One comment: the excerpt says it, so no separate count.
    expect(within(row('Onboarding')).queryByTitle('1 open comments')).toBeNull();
    expect(within(row('Plan')).getByText('In review')).toBeTruthy();
    expect(within(row('Glossary')).queryByText('Draft')).toBeNull();

    expect(within(row('Plan')).getByText('New edits')).toBeTruthy();
    expect(within(row('Glossary')).queryByText('New edits')).toBeNull();
    fireEvent.click(row('Plan'));
    await waitFor(() => expect(within(row('Plan')).queryByText('New edits')).toBeNull());
    const seen = JSON.parse(JSON.parse(localStorage.getItem('zcc.design-docs.list-seen')!)) as { docs: Record<string, number> };
    expect(seen.docs[plan.id]).toBe(harness.store.summary(plan.id).updatedAt);
  });

  it('pins docs, surfaces docs with open comments, and nests alternatives', async () => {
    const harness = createHarness();
    const trace = seed(harness.store, { title: 'Trace API', projectId: 'p1' });
    const unlocked = seed(harness.store, { title: 'Unlocked package', projectId: 'p1' });
    const review = seed(harness.store, { title: 'Onboarding', projectId: 'p1' });
    seed(harness.store, { title: 'Glossary', projectId: null });
    await harness.asAgent((store) => store.addComment(review.id, { body: 'Numbers?' }, AGENT));
    await harness.asAgent((store) => store.update(unlocked.id, { alternativeTo: trace.id }, AGENT));
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);

    // The project tab never groups by project, but keeps the smart sections.
    await waitFor(() => expect(sectionNames()).toEqual(['Needs me', 'Recent']));
    expect(screen.queryByRole('button', { name: 'Group by project' })).toBeNull();
    expect(titlesIn('Needs me')).toEqual(['Onboarding']);
    const recent = titlesIn('Recent');
    expect([...recent].sort()).toEqual(['Glossary', 'Trace API', 'Unlocked package']);
    // An alternative follows the doc it is an alternative to.
    expect(recent[recent.indexOf('Trace API') + 1]).toBe('Unlocked package');
    expect(row('Unlocked package').classList.contains('dd-doc-row-alt')).toBe(true);
    expect(within(row('Unlocked package')).getByText('Alt')).toBeTruthy();

    rightClick('Trace API');
    fireEvent.click(menuItem('Pin to top'));
    await waitFor(() => expect(sectionNames()).toEqual(['Pinned', 'Needs me', 'Recent']));
    expect(titlesIn('Pinned')).toEqual(['Trace API', 'Unlocked package']);
    expect(harness.store.summary(trace.id).revision).toBe(trace.revision);

    rightClick('Trace API');
    fireEvent.click(menuItem('Unpin'));
    await waitFor(() => expect(sectionNames()).toEqual(['Needs me', 'Recent']));

    harness.fail('pin', 'database locked');
    rightClick('Glossary');
    fireEvent.click(menuItem('Pin to top'));
    await waitFor(() => expect(harness.toasts.at(-1)).toEqual({ message: 'Could not pin the doc: database locked', kind: 'error' }));
  });

  it('marks a doc as an alternative from its menu, and detaches it', async () => {
    const harness = createHarness();
    const trace = seed(harness.store, { title: 'Trace API', projectId: 'p1' });
    const unlocked = seed(harness.store, { title: 'Unlocked package', projectId: 'p1' });
    seed(harness.store, { title: 'Elsewhere', projectId: 'p2' });
    harness.render(<ProjectTab pluginId="design-docs" projectId="p1" />);
    await screen.findByText('Unlocked package');

    rightClick('Unlocked package');
    fireEvent.click(menuItem('Alternative to…'));
    let dialog = screen.getByRole('dialog', { name: 'Alternative to…' });
    const select = (await within(dialog).findByRole('combobox')) as HTMLSelectElement;
    // Its project's docs and global ones only, never itself.
    expect([...select.options].map((option) => option.textContent)).toEqual(['Nothing: a doc of its own', 'Trace API']);
    const save = within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(select, { target: { value: trace.id } });
    fireEvent.click(save);
    await waitFor(() => expect(harness.store.summary(unlocked.id).alternativeTo).toBe(trace.id));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(row('Unlocked package').classList.contains('dd-doc-row-alt')).toBe(true));

    // A doc with alternatives cannot become one itself.
    rightClick('Trace API');
    fireEvent.click(menuItem('Alternative to…'));
    dialog = screen.getByRole('dialog', { name: 'Alternative to…' });
    expect(await within(dialog).findByText(/has 1 alternative of its own/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    rightClick('Unlocked package');
    expect(within(menuItem(/Alternative to/)).getByText('Linked')).toBeTruthy();
    fireEvent.click(menuItem(/Alternative to/));
    dialog = screen.getByRole('dialog', { name: 'Alternative to…' });
    fireEvent.change(await within(dialog).findByRole('combobox'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(harness.store.summary(unlocked.id).alternativeTo).toBeNull());
  });
});
