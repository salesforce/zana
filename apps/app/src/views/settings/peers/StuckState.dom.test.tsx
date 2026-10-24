// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PeerLink } from '@zana-ai/zcc-server-contract';
import { LeftoverAccess, StuckStateActions, forceRemoveText, leftoverText, stuckStateOf } from './StuckState';

afterEach(cleanup);

const mk = (over: Record<string, unknown> = {}) => ({ hostId: 'h', peerName: 'Mac', state: 'linked', connected: true, uses: [], ...over }) as unknown as PeerLink;

describe('stuckStateOf', () => {
  it.each([
    ['failed', {}, "Pairing didn't finish on this computer.", ['remove-anyway']],
    ['unclaimed', {}, 'No plugin owns this connection and nothing uses it.', ['remove-anyway']],
    ['pre-consent', { connected: false }, 'Waiting for the other computer…', ['retry', 'remove-anyway']],
    ['activating', { connected: false }, 'Waiting for the other computer…', ['retry', 'remove-anyway']],
    ['linked', { connected: false }, "Can't reach Mac. Check that both computers are on, running Zana, and on the same network.", ['reconnect', 'remove-anyway']]
  ])('%s', (state, over, text, actions) => {
    expect(stuckStateOf(mk({ state, ...over }))).toEqual({ text, actions });
  });

  it('is null for healthy, paused, removed and connected waiting links', () => {
    expect(stuckStateOf(mk())).toBeNull();
    expect(stuckStateOf(mk({ connected: false, paused: true }))).toBeNull();
    expect(stuckStateOf(mk({ state: 'removed' }))).toBeNull();
    expect(stuckStateOf(mk({ state: 'activating', connected: true }))).toBeNull();
  });

  it('uses the context name', () => {
    expect(stuckStateOf(mk({ connected: false }), { name: 'Mac (ab12)' })?.text).toContain('Mac (ab12)');
  });
});

describe('components', () => {
  it('StuckStateActions renders text and fires each action; disabled when busy', () => {
    const onAction = vi.fn();
    const { rerender } = render(<StuckStateActions link={mk({ connected: false })} onAction={onAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }));
    expect(onAction.mock.calls).toEqual([['reconnect'], ['remove-anyway']]);
    rerender(<StuckStateActions link={mk({ state: 'pre-consent', connected: false })} onAction={onAction} busy />);
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<StuckStateActions link={mk()} onAction={onAction} />);
    expect(screen.queryByTestId('peer-stuck')).toBeNull();
  });

  it('text helpers', () => {
    expect(forceRemoveText({ peerName: 'Mac', uses: [] })).toContain('Any plugin that used it may keep leftover access');
    expect(leftoverText({ computerId: 'c', name: 'Mac', plugins: [] })).toBe('Mac: A plugin may still hold access from a removal that did not finish cleaning up.');
  });

  it('LeftoverAccess renders nothing when empty', () => {
    render(<LeftoverAccess leftovers={[]} onForget={vi.fn()} />);
    expect(screen.queryByTestId('peer-leftovers')).toBeNull();
  });

  it('LeftoverAccess confirms before forgetting', () => {
    const onForget = vi.fn();
    render(<LeftoverAccess leftovers={[{ computerId: 'c', name: 'Mac', plugins: [{ pluginId: 'a', label: 'A', reason: 'error' }] }]} onForget={onForget} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget leftover access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm forget' }));
    expect(onForget).toHaveBeenCalledWith('c');
  });
});
