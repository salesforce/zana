/** @vitest-environment happy-dom */
import { act, cleanup, render } from '@testing-library/react';
import { type MutableRefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';
import { usePlaygroundBridge, type PlaygroundHandlers, type UsePlaygroundBridgeResult } from './studio/usePlaygroundBridge.js';

afterEach(cleanup);

function Harness({ draft, handlers, out }: { draft: MutableRefObject<string>; handlers: PlaygroundHandlers; out: { current?: UsePlaygroundBridgeResult } }) {
  const bridge = usePlaygroundBridge(draft);
  bridge.handlers.current = handlers;
  out.current = bridge;
  return <iframe ref={bridge.frameRef} title="f" src="about:blank" />;
}

function mount(handlers: PlaygroundHandlers = {}) {
  const draft = { current: 'k' } as MutableRefObject<string>;
  const out: { current?: UsePlaygroundBridgeResult } = {};
  render(<Harness draft={draft} handlers={handlers} out={out} />);
  const frame = out.current!.frameRef.current!;
  const fire = (data: unknown, source: unknown = frame.contentWindow, origin = window.location.origin) =>
    act(() => { window.dispatchEvent(new MessageEvent('message', { data, source: source as Window, origin })); });
  return { out, frame, fire };
}
const msg = (body: object) => ({ source: PLAYGROUND_BRIDGE_SOURCE, ...body });

describe('usePlaygroundBridge', () => {
  it('dispatches every validated playground message to its callback', () => {
    const h = Object.fromEntries(['onSnapshot', 'onOpenAction', 'onReady', 'onDirty', 'onRequestOpen', 'onPersist', 'onCursor', 'onProposalResolved', 'onCommentAction', 'onAskSelection', 'onSaveRequest'].map(k => [k, vi.fn()])) as Record<string, any>;
    const { fire } = mount(h);
    fire(msg({ type: 'snapshot', content: 'c', issues: 0 }));
    fire(msg({ type: 'openAction', id: 'a' }));
    fire(msg({ type: 'ready' }));
    fire(msg({ type: 'dirty', dirty: true, draftKey: 'k' }));
    fire(msg({ type: 'requestOpen', path: 'p' }));
    fire(msg({ type: 'persist', path: 'p', content: 'c' }));
    fire(msg({ type: 'cursor', line: 1, column: 1 }));
    fire(msg({ type: 'proposalResolved', proposalId: 'x', outcome: 'accepted', acceptedHunks: 1, rejectedHunks: 0, content: 'c' }));
    fire(msg({ type: 'commentAction', kind: 'open', line: 1, endLine: 1, quote: '' }));
    fire(msg({ type: 'askSelection', action: 'review', startLine: 1, endLine: 1, text: 't' }));
    fire(msg({ type: 'saveRequest' }));
    expect(h.onOpenAction).toHaveBeenCalledWith('a');
    expect(h.onRequestOpen).toHaveBeenCalledWith('p');
    for (const key of Object.keys(h)) expect(h[key], key).toHaveBeenCalledTimes(1);
  });
  it('ignores foreign origins, foreign sources, invalid payloads and other drafts', () => {
    const onReady = vi.fn(); const onDirty = vi.fn();
    const { fire } = mount({ onReady, onDirty });
    fire(msg({ type: 'ready' }), window, 'https://evil.example');
    fire(msg({ type: 'ready' }), window);
    fire({ type: 'ready' });
    fire(msg({ type: 'dirty', dirty: 'yes' }));
    fire(msg({ type: 'dirty', dirty: true, draftKey: 'other' }));
    expect(onReady).not.toHaveBeenCalled();
    expect(onDirty).not.toHaveBeenCalled();
  });
  it('tolerates missing optional handlers', () => {
    const { fire } = mount({});
    expect(() => fire(msg({ type: 'ready' }))).not.toThrow();
  });
  it('posts typed messages to the frame with the bridge source', () => {
    const { out, frame } = mount();
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const { send } = out.current!;
    send.setOrg(null); send.revealLine(4); send.flushSave(); send.flushSave({ path: 'a', create: true });
    send.clearProposal('p'); send.setHits([1]); send.setLayout(true); send.setComments([]);
    send.proposeEdit({ proposalId: 'p', content: 'c', summary: 's', actor: 'a' });
    send.saved({ sha256: 's' }); send.setTheme('light'); send.setFile({ path: null, content: '', dialect: 'agentforce', readOnly: false });
    send.init({ dialect: 'agentforce', theme: 'dark', examples: [], files: [], saveEnabled: true });
    expect(post.mock.calls.map(c => (c[0] as any).type)).toEqual(['setOrg', 'revealLine', 'flushSave', 'flushSave', 'clearProposal', 'setHits', 'setLayout', 'setComments', 'proposeEdit', 'saved', 'setTheme', 'setFile', 'init']);
    expect(post.mock.calls[0]![0]).toMatchObject({ source: PLAYGROUND_BRIDGE_SOURCE, org: null });
    expect(post.mock.calls[0]![1]).toBe(window.location.origin);
  });
  it('re-posts the theme when data-theme changes', async () => {
    const { out, frame } = mount();
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    document.documentElement.setAttribute('data-theme', 'light');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'setTheme', theme: 'light' }), window.location.origin);
    document.documentElement.removeAttribute('data-theme');
    expect(out.current).toBeTruthy();
  });
  it('does not throw when the frame is gone', () => {
    const { out } = mount();
    cleanup();
    expect(() => out.current!.send.setLayout(false)).not.toThrow();
  });
});
