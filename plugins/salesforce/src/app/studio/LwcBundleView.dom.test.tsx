/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({ callPluginRpc: rpc }));
const { LwcBundleView } = await import('./LwcBundleView.js');
const { clearReadCache } = await import('./read-cache.js');

afterEach(() => { cleanup(); rpc.mockReset(); clearReadCache(); });

const LWC = 'force-app/main/default/lwc/orderCard';
const READY = {
  ref: 'c/orderCard', name: 'orderCard', status: 'ready', path: LWC,
  files: [{ path: `${LWC}/orderCard.html`, content: '<template></template>' }, { path: `${LWC}/orderCard.js`, content: '', truncated: true }]
};

describe('LwcBundleView', () => {
  it('shows its last answer at once when it remounts, then reads again', async () => {
    rpc.mockResolvedValue({ ok: true, data: READY });
    const view = () => <LwcBundleView pluginId="sf" projectId="p1" componentRef="c/orderCard" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />;
    const first = render(view());
    expect(await screen.findByRole('heading', { name: 'orderCard' })).toBeTruthy();
    first.unmount();
    rpc.mockResolvedValue({ ok: true, data: { ...READY, files: [{ path: `${LWC}/orderCard.html`, content: '<template>new</template>' }] } });
    render(view());
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByLabelText(/Source of .*orderCard\.html/).textContent).toBe('<template></template>');
    await waitFor(() => expect(screen.getByLabelText(/Source of .*orderCard\.html/).textContent).toBe('<template>new</template>'));
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('shows the types and agents that reach the component, then its files', async () => {
    rpc.mockResolvedValue({ ok: true, data: READY });
    const onOpenAgent = vi.fn(); const onOpenType = vi.fn();
    render(<LwcBundleView pluginId="sf" projectId="p1" componentRef="c/orderCard" usedBy={['force-app/bots/Orders.agent']} via={['c__Order']} onOpenAgent={onOpenAgent} onOpenType={onOpenType} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'orderCard' })).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('sf', 'studio.lwc', { projectId: 'p1', ref: 'c/orderCard' });
    expect(screen.getByText('Lightning Web Component')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'c__Order' }));
    expect(onOpenType).toHaveBeenCalledWith('c__Order');
    fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
    expect(onOpenAgent).toHaveBeenCalledWith('force-app/bots/Orders.agent');
    expect(screen.getByLabelText(/Source of .*orderCard\.html/).textContent).toBe('<template></template>');
    expect(screen.getByRole('tab', { name: /template$/ }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /controller$/ }));
    expect(screen.getByLabelText(/Source of .*orderCard\.js/).textContent).toMatch(/larger than 256 KB/);
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });
  it('folds a numbered run of agents into one chip that unfolds to its members', async () => {
    rpc.mockResolvedValue({ ok: true, data: READY });
    const onOpenAgent = vi.fn();
    const usedBy = ['b/Voice_7.agent', 'b/Voice_10.agent', 'b/Review.agent', 'b/Voice_8.agent'];
    render(<LwcBundleView pluginId="sf" componentRef="c/orderCard" usedBy={usedBy} onOpenAgent={onOpenAgent} onOpenType={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'orderCard' })).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    const series = screen.getByRole('button', { name: 'Voice_7 to 10, 3 agents' });
    expect(series.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Voice_ agents' })).toBeNull();
    fireEvent.click(series);
    expect(series.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('button', { name: /^Voice_\d+$/ }).map(button => button.textContent)).toEqual(['7', '8', '10']);
    fireEvent.click(screen.getByRole('button', { name: 'Voice_8' }));
    expect(onOpenAgent).toHaveBeenCalledWith('b/Voice_8.agent');
    fireEvent.click(series);
    expect(screen.queryByRole('group', { name: 'Voice_ agents' })).toBeNull();
  });
  it('sketches the template in a script-less frame and copies a file', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    rpc.mockResolvedValue({ ok: true, data: { ...READY, files: [
      { path: `${LWC}/orderCard.html`, content: '<template><p>{title}</p></template>' },
      { path: `${LWC}/orderCard.css`, content: ':host { color: red; }' }
    ] } });
    render(<LwcBundleView pluginId="sf" componentRef="c/orderCard" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('<template><p>{title}</p></template>');
    expect(screen.getByLabelText(/Source of .*orderCard\.html/).querySelector('.tok-expr')?.textContent).toBe('{title}');
    fireEvent.click(screen.getByRole('tab', { name: 'Sketch' }));
    const frame = screen.getByTitle('Sketch of orderCard') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('<p><span class="sk-bind">‹title›</span></p>');
    expect(frame.getAttribute('srcdoc')).toContain('.sk-host { color: red; }');
    expect(screen.queryByLabelText(/Source of/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Cop/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /styles$/ }));
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByLabelText(/Source of .*orderCard\.css/).textContent).toBe(':host { color: red; }');
  });
  it('offers no sketch without a readable template, and ignores a failed copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    rpc.mockResolvedValue({ ok: true, data: { ...READY, files: [{ path: `${LWC}/orderCard.html`, content: '', truncated: true }, { path: `${LWC}/helper.js`, content: 'x' }] } });
    render(<LwcBundleView pluginId="sf" componentRef="c/orderCard" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    expect(await screen.findByRole('tab', { name: /template$/ })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Sketch' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /helper\.js$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await Promise.resolve(); await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });
  it('explains a missing component and an empty bundle', async () => {
    rpc.mockResolvedValueOnce({ ok: true, data: { ref: 'c/ghost', name: 'ghost', status: 'missing', files: [], message: 'No lwc/ghost bundle.' } });
    const { rerender } = render(<LwcBundleView pluginId="sf" componentRef="c/ghost" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    expect(await screen.findByText('Not in project')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('sf', 'studio.lwc', { ref: 'c/ghost' });
    expect(screen.getByText('No lwc/ghost bundle.').className).not.toContain('is-warn');
    expect(screen.queryByText('Bundle files')).toBeNull();
    rpc.mockResolvedValueOnce({ ok: true, data: { ...READY, files: [], message: 'This bundle has no readable files.' } });
    rerender(<LwcBundleView pluginId="sf" componentRef="c/empty" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    expect((await screen.findByText('This bundle has no readable files.')).className).toContain('is-warn');
  });
  it('reports read errors and ignores a late answer', async () => {
    rpc.mockResolvedValueOnce({ ok: false, error: 'nope' });
    const { rerender } = render(<LwcBundleView pluginId="sf" componentRef="c/a" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('nope');
    rpc.mockResolvedValueOnce(null);
    rerender(<LwcBundleView pluginId="sf" componentRef="c/b" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The component could not be read.'));
    rpc.mockRejectedValueOnce(new Error('offline'));
    rerender(<LwcBundleView pluginId="sf" componentRef="c/c" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('offline'));
    rpc.mockRejectedValueOnce('raw');
    rerender(<LwcBundleView pluginId="sf" componentRef="c/d" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('raw'));
    let resolve!: (value: unknown) => void;
    rpc.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    rpc.mockResolvedValueOnce({ ok: true, data: READY });
    rerender(<LwcBundleView pluginId="sf" componentRef="c/old" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    rerender(<LwcBundleView pluginId="sf" componentRef="c/orderCard" onOpenAgent={vi.fn()} onOpenType={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'orderCard' })).toBeTruthy();
    resolve({ ok: false, error: 'stale' });
    await Promise.resolve();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
