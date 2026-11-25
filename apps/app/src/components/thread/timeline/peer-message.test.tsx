// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { peerMessageDisplay, peerMessageSource } from './peer-message.js';
import { PeerMessageSource } from './PeerMessageSource.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const row = { role: 'user', initiator: 'agent', senderThreadId: 'thread-1',
  text: '[zcc message from thread:thread-1; hops:1; kind:thread]\nPeer: Queue reviewer\nCheck the idle race.' };
describe('peer conversation presentation', () => {
  it('removes matching transport metadata and renders a named, working source link', () => {
    const peer = peerMessageDisplay(row)!;
    expect(peer).toEqual({ label: 'Queue reviewer', kind: 'thread', text: 'Check the idle race.', href: '/threads/thread-1' });
    render(<PeerMessageSource peer={peer} />);
    const link = screen.getByRole('link', { name: 'Queue reviewer' });
    const push = vi.spyOn(history, 'pushState');
    fireEvent.click(link, { ctrlKey: true });
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(push).toHaveBeenCalledWith({}, '', '/threads/thread-1');
    expect(location.pathname).toBe('/threads/thread-1');
    expect(screen.getByTestId('thread-peer-message-source').textContent).toBe('Peer message fromQueue reviewer');
  });
  it('renders CLI attribution without inventing a thread link', () => {
    const peer = peerMessageDisplay({ ...row, text: row.text.replace('kind:thread', 'kind:cli-agent') })!;
    render(<PeerMessageSource peer={peer} />);
    expect(screen.queryByRole('link')).toBeNull(); expect(screen.getByText('Queue reviewer · CLI Agent')).toBeTruthy();
  });
  it('maps thread and CLI peers to bot-style message sources', () => {
    expect(peerMessageSource(peerMessageDisplay(row)!, 'thread-1')).toEqual({
      pluginId: 'sdk', kind: 'thread', label: 'Queue reviewer', threadId: 'thread-1', detail: 'messaged'
    });
    const cli = peerMessageDisplay({ ...row, text: row.text.replace('kind:thread', 'kind:cli-agent') })!;
    expect(peerMessageSource(cli, 'thread-1')).toEqual({ pluginId: 'sdk', kind: 'thread', label: 'Queue reviewer', detail: 'CLI Agent' });
  });
  it('preserves legacy messages without a display label', () => {
    expect(peerMessageDisplay({ ...row, text: '[bb message from thread:thread-1]\nlegacy body' })).toMatchObject({ label: 'thread-1', text: 'legacy body' });
  });
  it('does not hide text or attribute normal, assistant, missing or mismatched sender messages', () => {
    for (const next of [{ ...row, initiator: 'user' }, { ...row, role: 'assistant' }, { ...row, senderThreadId: null },
      { ...row, text: '' }, { ...row, text: 'plain message' }, { ...row, senderThreadId: 'other' }]) {
      expect(peerMessageDisplay(next)).toBeNull();
    }
  });
});
