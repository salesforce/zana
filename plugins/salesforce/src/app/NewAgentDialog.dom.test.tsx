/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewAgentDialog } from './NewAgentDialog.js';
const rpc = vi.fn(); const created = vi.fn(async () => {}); const close = vi.fn();
const destination = { ok: true, directory: 'agentforce-drafts/force-app/main/default/aiAuthoringBundles', initializesProject: true };
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function () { this.setAttribute('open', ''); });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function () { this.removeAttribute('open'); });
  rpc.mockReset(); created.mockClear(); close.mockClear();
  rpc.mockImplementation(async (_id, method) => method.endsWith('destination') ? destination : { ok: true, file: { path: 'Support/Support.agent' } });
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; });
const show = () => render(<NewAgentDialog pluginId="salesforce" projectId="p" onClose={close} onCreated={created} />);
it('previews destination, derives an editable API name and opens the complete created bundle', async () => {
  show(); await screen.findByText(/Creates an Agentforce project/);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Customer support' } });
  expect(screen.getByLabelText('API name')).toHaveProperty('value', 'Customer_support');
  fireEvent.change(screen.getByLabelText('API name'), { target: { value: 'Support' } });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Customer care' } });
  fireEvent.change(screen.getByLabelText(/Purpose/), { target: { value: 'Help with questions' } });
  fireEvent.click(screen.getByText('Create agent'));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(rpc).toHaveBeenCalledWith('salesforce', 'agents.draft.create', { projectId: 'p', name: 'Customer care', apiName: 'Support', purpose: 'Help with questions' });
  expect(created).toHaveBeenCalledWith({ path: 'Support/Support.agent' });
});
it('reports destination and creation failures without closing the draft form', async () => {
  rpc.mockRejectedValueOnce(Error('Folder unavailable')); const mounted = show();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Folder unavailable');
  expect(screen.getByText('Create agent')).toHaveProperty('disabled', true); mounted.unmount();
  rpc.mockImplementation(async (_id, method) => method.endsWith('destination') ? { ...destination, initializesProject: false } : { ok: false, error: 'Name exists' });
  show(); await screen.findByText(/Saved in/); fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Support' } });
  fireEvent.click(screen.getByText('Create agent'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Name exists'); expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Cancel')); expect(close).toHaveBeenCalledOnce();
});
it('prevents duplicate creation and ignores late results after unmount', async () => {
  let finish!: (value: unknown) => void;
  rpc.mockImplementation(async (_id, method) => method.endsWith('destination') ? destination : new Promise(resolve => { finish = resolve; }));
  const mounted = show(); await screen.findByText(/Saved in/);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Support' } });
  fireEvent.click(screen.getByText('Create agent')); fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  expect(screen.getByText('Cancel')).toHaveProperty('disabled', true);
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })); expect(close).not.toHaveBeenCalled();
  expect(rpc.mock.calls.filter(row => row[1].endsWith('create'))).toHaveLength(1);
  mounted.unmount(); finish({ ok: true, file: { path: 'Support.agent' } });
  await Promise.resolve(); expect(created).not.toHaveBeenCalled();
});
it('handles Escape when idle', () => { show(); fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true })); expect(close).toHaveBeenCalledOnce(); });

it('discards destination responses from a previously selected project', async () => {
  let finish!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const mounted = show();
  mounted.rerender(<NewAgentDialog pluginId="salesforce" projectId="next" onClose={close} onCreated={created} />);
  await screen.findByText(/Saved in/);
  await act(async () => { finish({ ...destination, directory: 'old-project' }); });
  expect(screen.queryByText(/old-project/)).toBeNull();
});

it('does not open a completed creation in another project after switching', async () => {
  let finish!: (value: unknown) => void;
  rpc.mockImplementation(async (_id, method) => method.endsWith('destination') ? destination : new Promise(resolve => { finish = resolve; }));
  const mounted = show(); await screen.findByText(/Saved in/);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Support' } });
  fireEvent.click(screen.getByText('Create agent'));
  mounted.rerender(<NewAgentDialog pluginId="salesforce" projectId="next" onClose={close} onCreated={created} />);
  await screen.findByText(/Saved in/);
  await act(async () => { finish({ ok: true, file: { path: 'old-project/Support.agent' } }); });
  expect(created).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Name')).toHaveProperty('value', '');
  expect(screen.getByText('Cancel')).toHaveProperty('disabled', false);
});
