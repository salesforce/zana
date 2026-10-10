/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrgAgentsPanel } from './OrgAgentsPanel.js';

const data = { org: { alias: 'dev', orgId: '00D000000000001' }, agents: [{ name: 'Support_Agent', versions: [{ fullName: 'Support_Agent_v2', version: 2 }, { fullName: 'Support_Agent_v1', version: 1 }] }, { name: 'Concierge', versions: [{ fullName: 'Concierge', version: null }] }], truncated: false };
const file = { path: 'agentforce/00D000000000001/Support_Agent_v1/Support.agent', fullName: 'Support_Agent_v1', orgId: data.org.orgId, existing: false };
const rpc = vi.fn(); const onOpen = vi.fn(async () => {});
function panel(props: Partial<Parameters<typeof OrgAgentsPanel>[0]> = {}) { return <OrgAgentsPanel pluginId="salesforce" projectId="project" visible editorReady onOpen={onOpen} {...props} />; }
beforeEach(() => {
  rpc.mockReset(); onOpen.mockClear();
  rpc.mockImplementation(async (_plugin, method) => method === 'agents.list' ? { ok: true, data } : method === 'agents.retrieve.start' ? { ok: true, jobId: 'job' } : { ok: true, data: { state: 'done', file } });
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; });

it('loads on demand, searches, selects the exact version and opens the retrieved file', async () => {
  const view = render(panel({ visible: false })); expect(rpc).not.toHaveBeenCalled();
  view.rerender(panel()); await screen.findByText('Support Agent');
  fireEvent.change(screen.getByLabelText('Search org agents'), { target: { value: 'Support' } });
  expect(screen.queryByText('Concierge')).toBeNull();
  fireEvent.change(screen.getByLabelText('Source version for Support_Agent'), { target: { value: 'Support_Agent_v1' } });
  fireEvent.click(screen.getByText('Retrieve & open'));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(file, expect.any(Function)));
  expect(rpc).toHaveBeenCalledWith('salesforce', 'agents.retrieve.start', { projectId: 'project', orgId: data.org.orgId, fullName: 'Support_Agent_v1' });
  expect(screen.getByRole('status').textContent).toContain('saved locally');
  view.rerender(panel({ visible: false })); view.rerender(panel());
  expect(rpc.mock.calls.filter(call => call[1] === 'agents.list')).toHaveLength(1);
});

it('refreshes empty and failed inventories and exposes filtering empty states', async () => {
  rpc.mockResolvedValueOnce({ ok: false, error: 'Permission denied' });
  const onNew = vi.fn();
  render(panel({ onNew })); expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
  rpc.mockResolvedValueOnce({ ok: true, data: { ...data, agents: [] } });
  fireEvent.click(screen.getByLabelText('Refresh agents')); await screen.findByText('No Agent Script sources found');
  rpc.mockResolvedValueOnce({ ok: false, error: 'Permission denied again' });
  fireEvent.click(screen.getByLabelText('Refresh agents'));
  await screen.findByText('Permission denied again');
  expect(screen.getByRole('heading', { name: 'Org agents unavailable' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create a local agent' }));
  expect(onNew).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByLabelText('Refresh agents')); await screen.findByText('Support Agent');
  fireEvent.change(screen.getByLabelText('Search org agents'), { target: { value: 'missing' } });
  expect(screen.getByText('No matching agents')).toBeTruthy();
});

it('preserves local edits, handles failures and waits for the editor to be ready', async () => {
  const view = render(panel({ editorReady: false })); await screen.findByText('Support Agent');
  expect(screen.getAllByText('Retrieve & open')[0]).toHaveProperty('disabled', true);
  view.rerender(panel());
  rpc.mockImplementation(async (_plugin, method) => method === 'agents.retrieve.start' ? { ok: true, jobId: 'job' } : { ok: true, data: { state: 'done', file: { ...file, existing: true } } });
  fireEvent.click(screen.getAllByText('Retrieve & open')[0]); await screen.findByText('Opened your local copy. Existing edits were preserved.');
  rpc.mockResolvedValue({ ok: false, error: 'CLI unavailable' });
  fireEvent.click(screen.getAllByText('Retrieve & open')[0]); expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'CLI unavailable');
});

it('discards stale results and cancels an in-flight retrieval when the org changes', async () => {
  let complete!: (value: unknown) => void;
  render(panel()); await screen.findByText('Support Agent');
  rpc.mockImplementation(async (_plugin, method) => {
    if (method === 'agents.list') return { ok: true, data: { ...data, org: { alias: 'other', orgId: 'new' }, agents: [] } };
    if (method === 'agents.retrieve.start') return { ok: true, jobId: 'job' };
    if (method === 'agents.retrieve.status') return new Promise(resolve => { complete = resolve; });
    return { ok: true };
  });
  fireEvent.click(screen.getAllByText('Retrieve & open')[0]); await waitFor(() => expect(complete).toBeTypeOf('function'));
  await act(async () => { window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId: 'unrelated' } })); });
  expect(rpc.mock.calls.some(call => call[1] === 'agents.retrieve.cancel')).toBe(false);
  await act(async () => { window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId: 'project' } })); });
  await screen.findByText('other');
  await act(async () => { complete({ ok: true, data: { state: 'done', file } }); });
  expect(onOpen).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith('salesforce', 'agents.retrieve.cancel', { projectId: 'project', jobId: 'job' });
});

it('reports a failed retrieval and rejects a mismatched org response', async () => {
  render(panel()); await screen.findByText('Support Agent');
  rpc.mockImplementation(async (_plugin, method) => method === 'agents.retrieve.start' ? { ok: true, jobId: 'job' } : { ok: true, data: { state: 'failed', error: 'No Agent Script in this version' } });
  fireEvent.click(screen.getAllByText('Retrieve & open')[0]); await screen.findByText('No Agent Script in this version');
  rpc.mockImplementation(async (_plugin, method) => method === 'agents.retrieve.start' ? { ok: true, jobId: 'job' } : { ok: true, data: { state: 'done', file: { ...file, orgId: 'different' } } });
  fireEvent.click(screen.getAllByText('Retrieve & open')[0]); await screen.findByText('The org changed. Refresh and select your agent again.');
  expect(onOpen).not.toHaveBeenCalled();
});

it('cancels a job that starts after the panel was unmounted', async () => {
  let start!: (value: unknown) => void;
  const view = render(panel()); await screen.findByText('Support Agent');
  rpc.mockImplementation(async (_plugin, method) => method === 'agents.retrieve.start' ? new Promise(resolve => { start = resolve; }) : { ok: true });
  fireEvent.click(screen.getAllByText('Retrieve & open')[0]); view.unmount();
  await act(async () => { start({ ok: true, jobId: 'late' }); });
  expect(rpc).toHaveBeenCalledWith('salesforce', 'agents.retrieve.cancel', { projectId: 'project', jobId: 'late' });
  expect(onOpen).not.toHaveBeenCalled();
});

it('shows loading artwork and keeps local creation available after an org access failure', async () => {
  let resolve!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const onNew = vi.fn();
  render(panel({ onNew }));
  expect(screen.getByRole('status').textContent).toContain('Loading agents');
  await act(async () => resolve({ ok: false, error: 'Metadata API access denied' }));
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('Metadata API access denied');
  fireEvent.click(screen.getByRole('button', { name: 'Create a local agent' }));
  expect(onNew).toHaveBeenCalledOnce();
});

it('focuses the search on request and, given a name, filters to it and opens its latest source once ready', async () => {
  const onFocusHandled = vi.fn();
  const view = render(panel({ editorReady: false, focus: null, onFocusHandled }));
  await screen.findByText('Support Agent');
  const search = screen.getByLabelText('Search org agents');
  expect(document.activeElement).not.toBe(search);
  view.rerender(panel({ editorReady: false, focus: { seq: 1 }, onFocusHandled }));
  expect(document.activeElement).toBe(search);
  expect(onFocusHandled).toHaveBeenLastCalledWith(1);
  expect(search).toHaveProperty('value', '');
  view.rerender(panel({ editorReady: false, focus: { name: 'Support_Agent', seq: 2 } }));
  expect(search).toHaveProperty('value', 'Support_Agent');
  expect(screen.queryByText('Concierge')).toBeNull();
  expect(rpc.mock.calls.some(call => call[1] === 'agents.retrieve.start')).toBe(false);
  view.rerender(panel({ focus: { name: 'Support_Agent', seq: 2 } }));
  await waitFor(() => expect(onOpen).toHaveBeenCalledWith(file, expect.any(Function)));
  expect(rpc).toHaveBeenCalledWith('salesforce', 'agents.retrieve.start', { projectId: 'project', orgId: data.org.orgId, fullName: 'Support_Agent_v2' });
  // The same request is not replayed on later renders.
  view.rerender(panel({ focus: { name: 'Support_Agent', seq: 2 } }));
  expect(rpc.mock.calls.filter(call => call[1] === 'agents.retrieve.start')).toHaveLength(1);
});

it('waits for the inventory before opening a named agent and reports one without Agent Script source', async () => {
  let resolve!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(panel({ focus: { name: 'Concierge', seq: 1 } }));
  expect(rpc.mock.calls.some(call => call[1] === 'agents.retrieve.start')).toBe(false);
  await act(async () => resolve({ ok: true, data }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', 'agents.retrieve.start', { projectId: 'project', orgId: data.org.orgId, fullName: 'Concierge' }));
  await waitFor(() => expect(onOpen).toHaveBeenCalled());
  // A miss reloads the inventory once before it is reported.
  view.rerender(panel({ focus: { name: 'Legacy_Bot', seq: 2 } }));
  expect((await screen.findByRole('alert')).textContent).toBe('Legacy_Bot has no Agent Script source in dev.');
  expect(rpc.mock.calls.filter(call => call[1] === 'agents.list')).toHaveLength(2);
});

it('reloads a stale inventory to open an agent the explorer already lists', async () => {
  const view = render(panel()); await screen.findByText('Support Agent');
  const published = { ...data, agents: [...data.agents, { name: 'New_Agent', versions: [{ fullName: 'New_Agent_v1', version: 1 }] }] };
  rpc.mockImplementation(async (_plugin, method) => method === 'agents.list' ? { ok: true, data: published } : method === 'agents.retrieve.start' ? { ok: true, jobId: 'job' } : { ok: true, data: { state: 'done', file } });
  view.rerender(panel({ focus: { name: 'New_Agent', seq: 1 } }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('salesforce', 'agents.retrieve.start', { projectId: 'project', orgId: data.org.orgId, fullName: 'New_Agent_v1' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps the real inventory error and never replays a request after the inventory fails', async () => {
  const view = render(panel()); await screen.findByText('Support Agent');
  rpc.mockResolvedValueOnce({ ok: false, error: 'Session expired' });
  view.rerender(panel({ focus: { name: 'New_Agent', seq: 1 } }));
  expect((await screen.findByRole('alert')).textContent).toBe('Session expired');
  view.unmount(); rpc.mockClear();
  // First load failed outright: the request is dropped, so a later manual refresh opens nothing.
  rpc.mockResolvedValueOnce({ ok: false, error: 'Org unreachable' });
  render(panel({ focus: { name: 'Support_Agent', seq: 1 } }));
  await screen.findByText('Org unreachable');
  fireEvent.click(screen.getByLabelText('Refresh agents'));
  await screen.findByText('Support Agent');
  expect(rpc.mock.calls.filter(call => call[1] === 'agents.list')).toHaveLength(2);
  expect(rpc.mock.calls.some(call => call[1] === 'agents.retrieve.start')).toBe(false);
});

it('drops a pending named open when the org context changes', async () => {
  let resolve!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(panel({ focus: { name: 'Support_Agent', seq: 1 } }));
  await act(async () => { window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId: 'project' } })); });
  await act(async () => resolve({ ok: true, data }));
  await screen.findByText('Support Agent');
  expect(rpc.mock.calls.some(call => call[1] === 'agents.retrieve.start')).toBe(false);
});

it('opens an agent once when it is requested again while it is being retrieved', async () => {
  let complete!: (value: unknown) => void;
  rpc.mockImplementation(async (_plugin, method) => method === 'agents.list' ? { ok: true, data } : method === 'agents.retrieve.start' ? { ok: true, jobId: 'job' } : new Promise(resolve => { complete = resolve; }));
  const view = render(panel({ focus: { name: 'Support_Agent', seq: 1 } }));
  await waitFor(() => expect(complete).toBeTypeOf('function'));
  view.rerender(panel({ focus: { name: 'Support_Agent', seq: 2 } }));
  await act(async () => { complete({ ok: true, data: { state: 'done', file } }); });
  await screen.findByText('Retrieved to your project. Changes are saved locally.');
  expect(onOpen).toHaveBeenCalledOnce();
  expect(rpc.mock.calls.filter(call => call[1] === 'agents.retrieve.start')).toHaveLength(1);
});

it('reports a missing agent beside an empty inventory, and a later browse selects the old filter', async () => {
  rpc.mockImplementation(async (_plugin, method) => method === 'agents.list' ? { ok: true, data: { ...data, agents: [] } } : { ok: true });
  const view = render(panel({ focus: { name: 'Legacy_Bot', seq: 1 } }));
  expect((await screen.findByRole('alert')).textContent).toBe('Legacy_Bot has no Agent Script source in dev.');
  // The org answered, so this is not an unavailable org.
  expect(screen.queryByRole('heading', { name: 'Org agents unavailable' })).toBeNull();
  expect(screen.getByText('No matching agents')).toBeTruthy();
  view.rerender(panel({ focus: { seq: 2 } }));
  const search = screen.getByLabelText('Search org agents') as HTMLInputElement;
  expect(document.activeElement).toBe(search);
  expect([search.value, search.selectionStart, search.selectionEnd]).toEqual(['Legacy_Bot', 0, 'Legacy_Bot'.length]);
  expect(screen.queryByRole('alert')).toBeNull();
});
