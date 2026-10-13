/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import type { JsonValue, PluginExtensionPendingInteraction, PluginPendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import piApp from '../../../../../../plugins/provider-pi/app.tsx';
import askApp from '../../../../../../plugins/ask-user-question/app.js';
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


describe('host-rendered plugin questions', () => {
  function request(id: string): PluginPendingInteraction {
    return {
      id, threadId: 'thr-1', turnId: null, origin: { kind: 'plugin', pluginId: 'other-plugin', rendererId: 'ask-user-question' },
      status: 'pending', payload: { kind: 'plugin', title: 'Question', data: { questions: [
        { header: 'Color', question: 'Pick colors', multiSelect: true, options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: 'cool' }] },
        { question: 'Pick a size', options: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }
      ] } }, resolution: null, statusReason: null, createdAt: 1, resolvedAt: null
    };
  }
  function mount(id: string) {
    interpretPluginApp('other-plugin', askApp);
    return show(request(id));
  }
  function answer() {
    fireEvent.click(screen.getByRole('button', { name: 'Red warm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue cool' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'M', exact: true }));
  }

  it('uses one native shell with steps, descriptions and multi-select, preserving the tool result', async () => {
    const { container } = mount('styled');
    expect(container.querySelectorAll('.thread-pending-question-banner')).toHaveLength(1);
    expect(screen.getAllByTestId('thread-pending-banner')).toHaveLength(1);
    expect(screen.getByText('Waiting for answers to 2 questions')).toBeTruthy();
    expect(screen.getByText('Color')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    answer();
    expect(screen.getByText('2 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Red warm' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Blue cool' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(product.threads.interactions.respond).toHaveBeenCalledWith('thr-1', 'styled', { answers: [
      { question: 'Pick colors', selected: ['Red', 'Blue'], freeText: '' },
      { question: 'Pick a size', selected: ['M'], freeText: '' }
    ] }));
    expect(product.threads.interactions.resolve).not.toHaveBeenCalled();
  });

  it('retains answers and the active step after navigation and failed submissions; clears on success', async () => {
    vi.mocked(product.threads.interactions.respond).mockRejectedValueOnce(new Error('Host offline'));
    let view = mount('draft');
    answer();
    fireEvent.click(screen.getByRole('button', { name: 'Other…' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Custom size' } });
    view.unmount();
    view = show(request('draft'));
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Custom size');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByText('Host offline');
    view.unmount();
    view = show(request('draft'));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Custom size');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(product.threads.interactions.respond).toHaveBeenCalledTimes(2));
    await act(async () => {});
    view.unmount();
    show(request('draft'));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Red warm' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('retains drafts after failed cancellation and clears them only on successful cancellation', async () => {
    vi.mocked(product.threads.interactions.cancel).mockRejectedValueOnce('offline');
    let view = mount('cancel-draft');
    answer();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByText('Could not cancel question');
    view.unmount();
    view = show(request('cancel-draft'));
    expect(screen.getByRole('button', { name: 'M', exact: true }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(product.threads.interactions.cancel).toHaveBeenCalledTimes(2));
    expect(product.threads.interactions.cancel).toHaveBeenLastCalledWith('thr-1', 'cancel-draft');
    await act(async () => {});
    view.unmount();
    show(request('cancel-draft'));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Red warm' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('respects host resolving status and routes provider-origin question responses', async () => {
    interpretPluginApp('other-plugin', askApp);
    const providerRequest = { ...interaction(), payload: { kind: 'other-plugin/ask-user-question' as const, title: 'Question', data: request('provider').payload.data } };
    const view = show({ ...providerRequest, status: 'resolving' });
    expect((screen.getByRole('button', { name: 'Red warm' }) as HTMLButtonElement).disabled).toBe(true);
    view.unmount();
    show(providerRequest);
    answer();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(product.threads.interactions.resolve).toHaveBeenCalledWith('thr-1', 'pint_1', {
      kind: 'request_answer', value: { answers: [
        { question: 'Pick colors', selected: ['Red', 'Blue'], freeText: '' },
        { question: 'Pick a size', selected: ['M'], freeText: '' }
      ] }
    }));
  });
});
