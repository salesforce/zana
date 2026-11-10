/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk/app';
import askApp from '../../../../plugins/ask-user-question/app.js';
import { clearPluginSlots, interpretPluginApp } from '../plugins/plugin-slots.js';
import { PtyInteractionBanner, type PtySessionInteraction } from './pty-interaction-banner.js';

const events = new Map<string, (payload: unknown) => void>();
let reconnect: (() => void) | undefined;
vi.mock('../lib/product-ws.js', () => ({
  subscribeProductEvent: (type: string, fn: (payload: unknown) => void) => { events.set(type, fn); return () => events.delete(type); },
  subscribeProductReconnect: (fn: () => void) => { reconnect = fn; return () => { reconnect = undefined; }; }
}));
const apiJson = vi.fn();
vi.mock('../lib/fetch-with-app-surface.js', () => ({ apiJson: (...args: unknown[]) => apiJson(...args) }));

const request = (over: Partial<PtySessionInteraction> = {}): PtySessionInteraction => ({
  id: 'i1', sessionId: 's1', projectId: 'p', status: 'pending',
  origin: { kind: 'plugin', pluginId: 'form-plugin', rendererId: 'form' },
  payload: { kind: 'plugin', title: 'Confirm deploy', data: {}, requireHuman: true },
  createdAt: 1, expiresAt: 2, ...over
});

beforeEach(() => {
  apiJson.mockReset();
  interpretPluginApp('form-plugin', definePluginApp(app => app.slots.pendingInteraction({
    id: 'form',
    component: ({ submit, cancel }) => (<><button onClick={() => { void submit({ ok: true }).catch(() => undefined); }}>Answer</button><button onClick={() => void cancel()}>Dismiss</button></>)
  })));
});
afterEach(() => { delete (window as any).cc; cleanup(); clearPluginSlots('form-plugin'); events.clear(); });

describe('PtyInteractionBanner', () => {
  it('renders nothing without an open request, and ignores a failing list', async () => {
    apiJson.mockResolvedValueOnce([]);
    const { container } = render(<PtyInteractionBanner sessionId="s1" />);
    await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/pty-sessions/s1/interactions'));
    expect(container.querySelector('[data-testid="pty-interaction-banner"]')).toBeNull();
    apiJson.mockRejectedValueOnce(new Error('down'));
    await act(async () => { reconnect?.(); });
    expect(container.querySelector('[data-testid="pty-interaction-banner"]')).toBeNull();
  });

  it('lets only the newest refresh write, so a late older response cannot restore a resolved card', async () => {
    let releaseFirst: (items: PtySessionInteraction[]) => void = () => {};
    apiJson.mockImplementationOnce(() => new Promise<PtySessionInteraction[]>(resolve => { releaseFirst = resolve; }));
    render(<PtyInteractionBanner sessionId="s1" />);
    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(1));
    // A newer refresh (the next request) lands first.
    apiJson.mockResolvedValueOnce([request({ id: 'i2', payload: { kind: 'plugin', title: 'Second request', data: {}, requireHuman: true } })]);
    await act(async () => { events.get('pty-interactions:changed')?.({ sessionId: 's1' }); });
    expect(await screen.findByText('Second request')).toBeTruthy();
    // The older response, carrying the already-resolved card, arrives afterwards.
    await act(async () => { releaseFirst([request()]); });
    expect(screen.getByText('Second request')).toBeTruthy();
    expect(screen.queryByText('Confirm deploy')).toBeNull();
  });

  it('answers through desktop main so the human proof is minted outside the page', async () => {
    const respondSession = vi.fn(async () => undefined);
    (window as any).cc = { threads: { interactions: { respondSession } } };
    apiJson.mockResolvedValue([request()]);
    render(<PtyInteractionBanner sessionId="s1" />);
    await screen.findByTestId('pty-interaction-banner');
    expect(screen.getByText('Confirm deploy')).toBeTruthy();
    fireEvent.click(screen.getByText('Answer'));
    await waitFor(() => expect(respondSession).toHaveBeenCalledWith('s1', 'i1', { ok: true }));
    expect(apiJson).not.toHaveBeenCalledWith(expect.stringContaining('/respond'), expect.anything());
  });

  it('falls back to the product API outside desktop and cancels through it', async () => {
    apiJson.mockResolvedValue([request()]);
    render(<PtyInteractionBanner sessionId="s1" />);
    await screen.findByTestId('pty-interaction-banner');
    fireEvent.click(screen.getByText('Answer'));
    await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/pty-sessions/s1/interactions/i1/respond', { method: 'POST', body: JSON.stringify({ value: { ok: true } }) }));
    fireEvent.click(screen.getByText('Dismiss'));
    await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/pty-sessions/s1/interactions/i1/cancel', { method: 'POST' }));
  });

  it('shows the refusal when the answer is rejected', async () => {
    (window as any).cc = { threads: { interactions: { respondSession: vi.fn(async () => { throw new Error('Human proof required'); }) } } };
    apiJson.mockResolvedValue([request()]);
    render(<PtyInteractionBanner sessionId="s1" />);
    await screen.findByTestId('pty-interaction-banner');
    fireEvent.click(screen.getByText('Answer'));
    await screen.findByText('Human proof required');
  });

  it('shows a cancelable placeholder when the plugin form is not registered, and reports a failed cancel', async () => {
    apiJson.mockResolvedValue([request({ origin: { kind: 'plugin', pluginId: 'gone', rendererId: 'form' } })]);
    render(<PtyInteractionBanner sessionId="s1" />);
    await screen.findByText('Plugin form is not registered.');
    apiJson.mockRejectedValueOnce(new Error('cancel failed'));
    fireEvent.click(screen.getByText('Cancel'));
    await screen.findByText('cancel failed');
  });

  it('re-reads on a change for its own session only', async () => {
    apiJson.mockResolvedValueOnce([]);
    render(<PtyInteractionBanner sessionId="s1" />);
    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(1));
    apiJson.mockResolvedValue([request()]);
    act(() => events.get('pty-interactions:changed')?.({ sessionId: 'other' }));
    expect(apiJson).toHaveBeenCalledTimes(1);
    act(() => events.get('pty-interactions:changed')?.({ sessionId: 's1' }));
    await screen.findByTestId('pty-interaction-banner');
  });

  it('renders a question form slot and answers through the same path', async () => {
    const respondSession = vi.fn(async () => undefined);
    (window as any).cc = { threads: { interactions: { respondSession } } };
    interpretPluginApp('form-plugin', askApp);
    apiJson.mockResolvedValue([request({ origin: { kind: 'plugin', pluginId: 'form-plugin', rendererId: 'ask-user-question' }, payload: { kind: 'plugin', title: 'Q', requireHuman: true, data: { questions: [{ header: 'Q', question: 'Pick one', options: [{ label: 'Yes', description: 'y' }] }] } } })]);
    render(<PtyInteractionBanner sessionId="s1" />);
    await screen.findByText('Pick one');
    fireEvent.click(screen.getByText('Yes'));
    fireEvent.click(screen.getByText('Submit'));
    await waitFor(() => expect(respondSession).toHaveBeenCalledWith('s1', 'i1', { answers: [{ question: 'Pick one', selected: ['Yes'], freeText: '' }] }));
  });

  it('renders the host approval card for a tool-policy ask and answers through main', async () => {
    const respondSession = vi.fn(async () => undefined);
    (window as any).cc = { threads: { interactions: { respondSession } } };
    apiJson.mockResolvedValue([request({ origin: { kind: 'plugin', pluginId: 'form-plugin', rendererId: 'zcc:tool-policy-ask' }, payload: { kind: 'plugin', title: 'Approve tool call', requireHuman: true, data: { kind: 'tool-policy-ask', toolName: 'Bash', prompt: 'Run it?', inputPreview: 'ls' } } })]);
    render(<PtyInteractionBanner sessionId="s1" />);
    await screen.findByTestId('tool-policy-ask-prompt');
    fireEvent.click(screen.getByTestId('tool-policy-ask-allow'));
    await waitFor(() => expect(respondSession).toHaveBeenCalledWith('s1', 'i1', { decision: 'allow' }));
  });
});
