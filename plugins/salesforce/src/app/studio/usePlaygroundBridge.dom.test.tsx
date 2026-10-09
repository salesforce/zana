/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { usePlaygroundBridge, postToPlayground, type UsePlaygroundBridgeResult } from './usePlaygroundBridge.js';
import { PLAYGROUND_BRIDGE_SOURCE as source } from '../playground-bridge.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); delete document.documentElement.dataset.theme; });

let api!: UsePlaygroundBridgeResult;
let draft: { current: string };
function Host() {
  draft = useRef('k1');
  api = usePlaygroundBridge(draft);
  return <iframe ref={api.frameRef} title="frame" src="about:blank" />;
}
const frameWindow = () => api.frameRef.current!.contentWindow!;
const deliver = (data: object, o: { origin?: string; from?: Window | null } = {}) => act(() => { window.dispatchEvent(new MessageEvent('message', { origin: o.origin ?? location.origin, source: o.from === undefined ? frameWindow() : o.from, data: { source, ...data } })); });

it('sends typed host messages to the frame', () => {
  render(<Host />);
  const post = vi.spyOn(frameWindow(), 'postMessage').mockImplementation(() => undefined);
  const s = api.send;
  s.init({ dialect: 'agentforce', theme: 'dark', examples: [], files: [], saveEnabled: true });
  s.setFile({ path: 'a', content: 'c', dialect: 'agentforce', readOnly: false });
  s.setOrg(null); s.setTheme('light'); s.saved({ sha256: 'x' }); s.revealLine(4); s.flushSave({ create: true });
  s.proposeEdit({ proposalId: 'p', content: 'c', summary: 's', actor: 'a' }); s.clearProposal('p');
  s.setComments([]); s.setHits([1, 2]); s.setLayout(true);
  s.raw({ source, type: 'setDialect', dialect: 'agentforce' });
  expect(post.mock.calls.map(c => (c[0] as { type: string }).type)).toEqual(['init', 'setFile', 'setOrg', 'setTheme', 'saved', 'revealLine', 'flushSave', 'proposeEdit', 'clearProposal', 'setComments', 'setHits', 'setLayout', 'setDialect']);
  expect(post).toHaveBeenCalledWith({ source, type: 'setHits', lines: [1, 2] }, location.origin);
  expect(post).toHaveBeenCalledWith({ source, type: 'setLayout', compact: true }, location.origin);
});

it('postToPlayground tolerates a missing frame or a throwing window', () => {
  expect(() => postToPlayground(null, { source, type: 'setTheme', theme: 'dark' })).not.toThrow();
  const frame = { contentWindow: { postMessage: () => { throw new Error('x'); } } } as unknown as HTMLIFrameElement;
  expect(() => postToPlayground(frame, { source, type: 'setTheme', theme: 'dark' })).not.toThrow();
});

it('routes validated playground messages to the latest handlers and drops foreign ones', () => {
  render(<Host />);
  const h = { onSnapshot: vi.fn(), onOpenAction: vi.fn(), onReady: vi.fn(), onDirty: vi.fn(), onRequestOpen: vi.fn(), onPersist: vi.fn(), onCursor: vi.fn(), onProposalResolved: vi.fn(), onCommentAction: vi.fn(), onAskSelection: vi.fn(), onSaveRequest: vi.fn() };
  api.handlers.current = h;
  deliver({ type: 'ready' }, { origin: 'https://evil.example' });
  deliver({ type: 'ready' }, { from: window });
  deliver({ type: 'bogus' });
  deliver({ type: 'dirty', dirty: true, draftKey: 'other' });
  expect(h.onReady).not.toHaveBeenCalled(); expect(h.onDirty).not.toHaveBeenCalled();
  deliver({ type: 'ready' });
  deliver({ type: 'dirty', dirty: true, draftKey: 'k1' });
  deliver({ type: 'snapshot', content: 'x', issues: 0, diagnostics: [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'error', message: 'm' }] });
  deliver({ type: 'openAction', id: 'a' });
  deliver({ type: 'requestOpen', path: 'p' });
  deliver({ type: 'persist', path: 'p', content: 'c' });
  deliver({ type: 'cursor', line: 2, column: 3, selection: { startLine: 2, endLine: 2, text: 'ab' } });
  deliver({ type: 'proposalResolved', proposalId: 'p', outcome: 'partial', acceptedHunks: 1, rejectedHunks: 1, content: 'z' });
  deliver({ type: 'commentAction', kind: 'add', line: 1, endLine: 2, quote: 'q' });
  deliver({ type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 1, text: 't' });
  deliver({ type: 'saveRequest' });
  for (const [name, fn] of Object.entries(h)) expect([name, fn.mock.calls.length]).toEqual([name, 1]);
  expect(h.onProposalResolved.mock.calls[0]![0]).toMatchObject({ outcome: 'partial', content: 'z' });
  expect(h.onOpenAction).toHaveBeenCalledWith('a');
  expect(h.onRequestOpen).toHaveBeenCalledWith('p');
  deliver({ type: 'cursor', line: 0, column: 1 });
  expect(h.onCursor).toHaveBeenCalledTimes(1);
  api.handlers.current = {};
  deliver({ type: 'ready' });
  expect(h.onReady).toHaveBeenCalledTimes(1);
});

it('handles Cmd/Ctrl+S in the host window only when a save handler exists', () => {
  render(<Host />);
  const save = vi.fn();
  const press = (init: KeyboardEventInit) => { const e = new KeyboardEvent('keydown', { cancelable: true, ...init }); window.dispatchEvent(e); return e; };
  expect(press({ key: 's', metaKey: true }).defaultPrevented).toBe(false);
  api.handlers.current = { onSaveRequest: save };
  expect(press({ key: 's', metaKey: true }).defaultPrevented).toBe(true);
  press({ key: 'S', ctrlKey: true });
  press({ key: 's' }); press({ key: 's', metaKey: true, shiftKey: true }); press({ key: 'x', metaKey: true });
  expect(save).toHaveBeenCalledTimes(2);
});

it('forwards document theme changes', async () => {
  render(<Host />);
  const post = vi.spyOn(frameWindow(), 'postMessage').mockImplementation(() => undefined);
  await act(async () => { document.documentElement.dataset.theme = 'light'; });
  expect(post).toHaveBeenCalledWith({ source, type: 'setTheme', theme: 'light' }, location.origin);
  fireEvent.keyDown(window, { key: 'a' });
});
