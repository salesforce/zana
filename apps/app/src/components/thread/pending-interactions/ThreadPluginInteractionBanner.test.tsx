/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import type { JsonValue, PluginExtensionPendingInteraction, PluginPendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import piApp from '../../../../../../plugins/provider-pi/app.tsx';
import { interpretPluginApp, clearPluginSlots } from '../../../plugins/plugin-slots.js';
import { product } from '../../../lib/product-client.js';
import { ThreadPendingInteractionBanner } from './ThreadPendingInteractionBanner.js';

vi.mock('../../../lib/product-client.js', () => ({ product: { threads: { interactions: {
  resolve: vi.fn(async () => undefined), respond: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined)
} } } }));

function interaction(data: Record<string, JsonValue> = { requestId: 'ui-1', method: 'select', options: ['Allow once', 'Block'] }): PluginExtensionPendingInteraction {
  return {
    id: 'pint_1', threadId: 'thr-1', turnId: 'turn-1', providerId: 'pi', providerThreadId: 'pi-1', providerRequestId: 'req-1',
    origin: { kind: 'provider', providerId: 'pi', providerThreadId: 'pi-1', providerRequestId: 'req-1' },
    status: 'pending', payload: { kind: 'provider-pi/extension-ui', title: 'Choose an action', data },
    resolution: null, statusReason: null, createdAt: 1, resolvedAt: null
  };
}

function show(request: PluginExtensionPendingInteraction | PluginPendingInteraction = interaction()) {
  return render(<MemoryRouter><ThreadPendingInteractionBanner interaction={request} threadId="thr-1" sourceThread={{ href: '/threads/child', title: 'Child' }} /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  for (const id of ['provider-pi', 'other-plugin']) clearPluginSlots(id);
  vi.resetAllMocks();
});

describe('plugin request banners', () => {
  it('renders the real Pi picker and returns the selected label through provider resolve', async () => {
    interpretPluginApp('provider-pi', piApp);
    show();
    expect(screen.getByText('Choose an action')).toBeTruthy();
    expect(screen.getByText('From child agent: Child').getAttribute('href')).toBe('/threads/child');
    expect((screen.getByText('Submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Allow once'));
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledWith('thr-1', 'pint_1', { kind: 'request_answer', value: 'Allow once' }));
    expect(product.threads.interactions.respond).not.toHaveBeenCalled();
  });

  it.each([true, false])('returns a confirm answer %s without treating it as an approval', async (answer) => {
    interpretPluginApp('provider-pi', piApp);
    show(interaction({ requestId: 'ui-2', method: 'confirm', message: 'Continue?' }));
    fireEvent.click(screen.getByText(answer ? 'Yes' : 'No'));
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledWith('thr-1', 'pint_1', { kind: 'request_answer', value: answer }));
  });

  it.each(['input', 'editor'])('submits %s content unchanged', async (method) => {
    interpretPluginApp('provider-pi', piApp);
    show(interaction({ requestId: 'ui-3', method, prefill: 'original' }));
    const value = method === 'editor' ? 'é🙂\nsecond line' : 'é🙂';
    fireEvent.change(screen.getByRole('textbox'), { target: { value } });
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledWith('thr-1', 'pint_1', { kind: 'request_answer', value }));
  });

  it('cancels a provider request with null and prevents duplicate cancellation', async () => {
    interpretPluginApp('provider-pi', piApp);
    let release!: () => void;
    vi.mocked(product.threads.interactions.resolve).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(undefined as never); }));
    show();
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(product.threads.interactions.resolve).toHaveBeenCalledTimes(1);
    expect(product.threads.interactions.resolve).toHaveBeenCalledWith('thr-1', 'pint_1', { kind: 'request_answer', value: null });
    await act(async () => release());
    expect(product.threads.interactions.cancel).not.toHaveBeenCalled();
  });

  it('keeps a missing form visible and cancellable, then loads a late registration', async () => {
    interpretPluginApp('other-plugin', piApp);
    show();
    expect(screen.getByText('Plugin form is not registered.')).toBeTruthy();
    expect(screen.queryByText('Allow once')).toBeNull();
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledWith('thr-1', 'pint_1', { kind: 'request_answer', value: null }));
    act(() => { interpretPluginApp('provider-pi', piApp); });
    expect(screen.getByText('Allow once')).toBeTruthy();
    act(() => { clearPluginSlots('provider-pi'); });
    expect(screen.getByText('Plugin form is not registered.')).toBeTruthy();
  });

  it('remounts a replacement plugin form and resets selection for a new request', () => {
    interpretPluginApp('provider-pi', piApp);
    const view = show();
    fireEvent.click(screen.getByText('Allow once'));
    act(() => { interpretPluginApp('provider-pi', piApp); });
    expect((screen.getByText('Submit') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Allow once'));
    view.rerender(<MemoryRouter><ThreadPendingInteractionBanner interaction={{ ...interaction(), id: 'pint_2' }} threadId="thr-1" /></MemoryRouter>);
    expect((screen.getByText('Submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a submit failure and permits retry', async () => {
    interpretPluginApp('provider-pi', piApp);
    vi.mocked(product.threads.interactions.resolve).mockRejectedValueOnce(new Error('Host offline'));
    show();
    fireEvent.click(screen.getByText('Allow once'));
    fireEvent.click(screen.getByText('Submit'));
    await screen.findByText('Host offline');
    await waitFor(() => expect((screen.getByText('Submit') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Host offline')).toBeNull();
  });

  it('shows cancellation failures without an unhandled rejection and permits retry', async () => {
    vi.mocked(product.threads.interactions.resolve).mockRejectedValueOnce('offline');
    show();
    fireEvent.click(screen.getByText('Cancel'));
    await screen.findByText('Could not answer this request. Please try again.');
    await waitFor(() => expect((screen.getByText('Cancel') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledTimes(2));
  });

  it('preserves plugin-origin submission and cancellation endpoints', async () => {
    interpretPluginApp('other-plugin', definePluginApp(app => app.slots.pendingInteraction({ id: 'form', component: ({ submit, cancel }) => <>
      <button onClick={() => void submit({ answer: 'yes' })}>Answer</button>
      <button onClick={() => void cancel()}>Cancel</button>
    </> })));
    const request: PluginPendingInteraction = {
      id: 'plugin-1', threadId: 'thr-1', turnId: null, origin: { kind: 'plugin', pluginId: 'other-plugin', rendererId: 'form' },
      status: 'pending', payload: { kind: 'plugin', title: 'Plugin question', data: {} }, resolution: null, statusReason: null, createdAt: 1, resolvedAt: null
    };
    show(request);
    fireEvent.click(screen.getByText('Answer'));
    await waitFor(() => expect(product.threads.interactions.respond).toHaveBeenCalledWith('thr-1', 'plugin-1', { answer: 'yes' }));
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(product.threads.interactions.cancel).toHaveBeenCalledWith('thr-1', 'plugin-1'));
    expect(product.threads.interactions.resolve).not.toHaveBeenCalled();
  });
});
