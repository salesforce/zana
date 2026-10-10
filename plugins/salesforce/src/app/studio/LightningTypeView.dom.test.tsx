/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({ callPluginRpc: rpc }));
const { LightningTypeView } = await import('./LightningTypeView.js');

afterEach(() => { cleanup(); rpc.mockReset(); });

const READY = {
  ref: 'c__OrderRequest', standard: false, status: 'ready', path: 'force-app/main/default/lightningTypes/OrderRequest', title: 'Order request', description: 'What the agent sends.',
  properties: [{ name: 'orderId', type: 'lightning__textType', title: 'Order', description: 'Order number', required: true }, { name: 'notes', required: false }],
  files: [
    { path: 'force-app/main/default/lightningTypes/OrderRequest/schema.json', content: '{"title":"Order request"}' },
    { path: 'force-app/main/default/lightningTypes/OrderRequest/lightningDesktopGenAi/renderer.json', content: '', truncated: true }
  ]
};

describe('LightningTypeView', () => {
  it('shows properties, used-by links and bundle files', async () => {
    rpc.mockResolvedValue({ ok: true, data: READY });
    const onOpenAgent = vi.fn();
    render(<LightningTypeView pluginId="sf" projectId="p1" typeRef="c__OrderRequest" usedBy={['force-app/bots/Orders.agent']} onOpenAgent={onOpenAgent} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Order request' })).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('sf', 'studio.lightningType', { projectId: 'p1', ref: 'c__OrderRequest' });
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByText('What the agent sends.')).toBeTruthy();
    expect(screen.getByTitle('Required')).toBeTruthy();
    expect(screen.getByText('Order number')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Orders.agent' }));
    expect(onOpenAgent).toHaveBeenCalledWith('force-app/bots/Orders.agent');
    expect(screen.getByLabelText(/Source of .*schema\.json/).textContent).toBe('{"title":"Order request"}');
    fireEvent.click(screen.getByRole('button', { name: 'lightningDesktopGenAi/renderer.json' }));
    expect(screen.getByLabelText(/Source of .*renderer\.json/).textContent).toMatch(/larger than 256 KB/);
  });
  it('explains standard and missing types without a properties table', async () => {
    rpc.mockResolvedValueOnce({ ok: true, data: { ref: 'lightning__textType', standard: true, status: 'standard', properties: [], files: [], message: 'A standard Lightning Type.' } });
    const { rerender } = render(<LightningTypeView pluginId="sf" typeRef="lightning__textType" onOpenAgent={vi.fn()} />);
    expect(await screen.findByText('Standard')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('sf', 'studio.lightningType', { ref: 'lightning__textType' });
    expect(screen.getByText('A standard Lightning Type.')).toBeTruthy();
    expect(screen.queryByText('Properties')).toBeNull();
    rpc.mockResolvedValueOnce({ ok: true, data: { ref: 'c__Ghost', standard: false, status: 'missing', properties: [], files: [], message: 'No bundle.' } });
    rerender(<LightningTypeView pluginId="sf" typeRef="c__Ghost" onOpenAgent={vi.fn()} />);
    expect(await screen.findByText('Not in project')).toBeTruthy();
  });
  it('shows an empty schema and read errors', async () => {
    rpc.mockResolvedValueOnce({ ok: true, data: { ...READY, properties: [], files: [], message: 'schema.json is not valid JSON.' } });
    const { rerender } = render(<LightningTypeView pluginId="sf" typeRef="c__A" onOpenAgent={vi.fn()} />);
    expect(await screen.findByText('No properties')).toBeTruthy();
    expect(screen.getByText('schema.json is not valid JSON.').className).toContain('is-warn');
    rpc.mockResolvedValueOnce({ ok: false, error: 'nope' });
    rerender(<LightningTypeView pluginId="sf" typeRef="c__B" onOpenAgent={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
    rpc.mockResolvedValueOnce(null);
    rerender(<LightningTypeView pluginId="sf" typeRef="c__C" onOpenAgent={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The Lightning Type could not be read.'));
    rpc.mockRejectedValueOnce(new Error('offline'));
    rerender(<LightningTypeView pluginId="sf" typeRef="c__D" onOpenAgent={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('offline'));
    rpc.mockRejectedValueOnce('raw');
    rerender(<LightningTypeView pluginId="sf" typeRef="c__E" onOpenAgent={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('raw'));
  });
  it('ignores a late answer after the type changes', async () => {
    let resolve!: (value: unknown) => void;
    rpc.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    rpc.mockResolvedValueOnce({ ok: true, data: READY });
    const { rerender } = render(<LightningTypeView pluginId="sf" typeRef="c__Old" onOpenAgent={vi.fn()} />);
    rerender(<LightningTypeView pluginId="sf" typeRef="c__OrderRequest" onOpenAgent={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Order request' })).toBeTruthy();
    resolve({ ok: false, error: 'stale' });
    await Promise.resolve();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
