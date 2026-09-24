// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TasksHostContext, experimental_ProviderModelPicker as Picker, experimental_PermissionModePicker as Permissions } from './app';

afterEach(cleanup);
const value = { providerId: 'capable', model: 'model-a', reasoningLevel: 'high' as const, serviceTier: 'fast' as const };
const catalog = {
  providers: [
    { id: 'capable', displayName: 'Capable', capabilities: { supportsServiceTier: true, permissionModes: ['full'] } },
    { id: 'plain', displayName: 'Plain', capabilities: { supportsServiceTier: false } },
  ],
  catalog: { models: [{ id: 'model-a', model: 'model-a', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }] },
};

it('loads the selected host catalog and only offers service tiers for a capable provider', async () => {
  const call = vi.fn(async () => catalog);
  const rpc = { call };
  const host = { useRpc: () => rpc } as never;
  const onChange = vi.fn();
  const view = render(<TasksHostContext.Provider value={host}><Picker value={value} onChange={onChange} routing={{ kind: 'host', hostId: 'host-1' }} /></TasksHostContext.Provider>);
  await screen.findByLabelText('Service tier');
  expect(call).toHaveBeenCalledWith('executionCatalog', { providerId: 'capable', hostId: 'host-1' });
  fireEvent.change(screen.getByLabelText('Service tier'), { target: { value: 'default' } });
  expect(onChange).toHaveBeenLastCalledWith({ ...value, serviceTier: 'default' });
  fireEvent.change(screen.getByLabelText('Reasoning level'), { target: { value: 'low' } });
  expect(onChange).toHaveBeenLastCalledWith({ ...value, reasoningLevel: 'low' });
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'plain' } });
  expect(onChange).toHaveBeenLastCalledWith({ ...value, providerId: 'plain', model: '', serviceTier: undefined });
  view.rerender(<TasksHostContext.Provider value={host}><Picker value={{ ...value, providerId: 'plain', serviceTier: undefined }} onChange={onChange} /></TasksHostContext.Provider>);
  await waitFor(() => expect(call).toHaveBeenCalledWith('executionCatalog', { providerId: 'plain', hostId: undefined }));
  expect(screen.queryByLabelText('Service tier')).toBeNull();
});

it('keeps saved model choices readable on discovery failure and respects permission capabilities', async () => {
  const rpc = { call: vi.fn(async () => ({ ...catalog, catalog: { models: [], modelLoadError: { code: 'offline' } } })) };
  const onChange = vi.fn();
  render(<TasksHostContext.Provider value={{ useRpc: () => rpc } as never}>
    <Picker value={value} onChange={onChange} />
    <Permissions value="full" onChange={onChange} providerId="capable" />
  </TasksHostContext.Provider>);
  expect((await screen.findByRole('alert')).textContent).toContain('discovery unavailable');
  expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('model-a');
  expect(onChange).not.toHaveBeenCalled();
  expect((screen.getByRole('option', { name: 'Accept Edits' }) as HTMLOptionElement).disabled).toBe(true);
  expect((screen.getByRole('option', { name: 'Full Access' }) as HTMLOptionElement).disabled).toBe(false);
});

it('normalizes stale model and reasoning selections only after live discovery', async () => {
  const rpc = { call: vi.fn(async () => catalog) };
  const onChange = vi.fn();
  render(<TasksHostContext.Provider value={{ useRpc: () => rpc } as never}>
    <Picker value={{ ...value, model: 'removed', reasoningLevel: 'ultra' }} onChange={onChange} />
  </TasksHostContext.Provider>);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...value, model: 'model-a', reasoningLevel: 'high' }));
  expect(screen.queryByRole('option', { name: 'ultra' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'removed' })).toBeNull();
});

it('keeps a selected-only model, reconciles to the closest effort, and clears unsupported fast mode', async () => {
  const rpc = { call: vi.fn(async () => ({ ...catalog, catalog: { ...catalog.catalog,
    selectedOnlyModels: [{ ...catalog.catalog.models[0], id: 'retired', model: 'retired' }] } })) };
  const onChange = vi.fn();
  render(<TasksHostContext.Provider value={{ useRpc: () => rpc } as never}>
    <Picker value={{ ...value, providerId: 'plain', model: 'retired', reasoningLevel: 'medium' }} onChange={onChange} />
  </TasksHostContext.Provider>);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ providerId: 'plain', model: 'retired', reasoningLevel: 'high', serviceTier: undefined }));
  expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('retired');
});

it('does not apply the previous provider catalog while the next provider loads', async () => {
  const rpc = { call: vi.fn().mockResolvedValueOnce(catalog).mockImplementation(() => new Promise(() => {})) };
  const host = { useRpc: () => rpc } as never;
  const onChange = vi.fn();
  const view = render(<TasksHostContext.Provider value={host}><Picker value={value} onChange={onChange} /></TasksHostContext.Provider>);
  await screen.findByLabelText('Service tier');
  view.rerender(<TasksHostContext.Provider value={host}><Picker value={{ ...value, providerId: 'plain', model: 'next-model' }} onChange={onChange} /></TasksHostContext.Provider>);
  expect(onChange).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('next-model');
});

it('preserves saved execution settings when the host RPC rejects', async () => {
  const rpc = { call: vi.fn(async () => { throw new Error('Host offline'); }) };
  const onChange = vi.fn();
  render(<TasksHostContext.Provider value={{ useRpc: () => rpc } as never}>
    <Picker value={value} onChange={onChange} />
  </TasksHostContext.Provider>);
  expect((await screen.findByRole('alert')).textContent).toContain('Host offline');
  expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('model-a');
  expect((screen.getByLabelText('Model') as HTMLSelectElement).disabled).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});

it('resolves a unique provider-prefixed model without losing supported reasoning', async () => {
  const rpc = { call: vi.fn(async () => ({ ...catalog, catalog: { models: [
    { ...catalog.catalog.models[0], model: 'provider/model-a' },
    { id: 'default', model: 'default-model', isDefault: true, supportedReasoningEfforts: [] },
  ] } })) };
  const onChange = vi.fn();
  render(<TasksHostContext.Provider value={{ useRpc: () => rpc } as never}>
    <Picker value={value} onChange={onChange} />
  </TasksHostContext.Provider>);
  await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...value, model: 'provider/model-a' }));
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'default-model' } });
  expect(onChange).toHaveBeenLastCalledWith({ ...value, model: 'default-model' });
});
