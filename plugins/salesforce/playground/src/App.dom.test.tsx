/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { PLAYGROUND_BRIDGE_SOURCE as source } from '../../src/app/playground-bridge.js';

const h = vi.hoisted(() => {
  const state = { value: '', mouse: null as null | ((e: any) => void), content: null as null | (() => void) };
  const model = {
    getValue: () => state.value,
    setValue: vi.fn((v: string) => { state.value = v; state.content?.(); }),
    getLineContent: (n: number) => state.value.split('\n')[n - 1] ?? '',
    dispose: vi.fn()
  };
  const instance = {
    getValue: () => state.value,
    updateOptions: vi.fn(),
    revealLineInCenter: vi.fn(),
    setPosition: vi.fn(),
    focus: vi.fn(),
    dispose: vi.fn(),
    onDidChangeModelContent: (cb: () => void) => { state.content = cb; return { dispose: vi.fn() }; },
    onMouseDown: (cb: (e: any) => void) => { state.mouse = cb; return { dispose: vi.fn() }; }
  };
  const layer = { setProposal: vi.fn(), clearProposal: vi.fn(), setComments: vi.fn(), setHits: vi.fn(), onFileSwitched: vi.fn(), dispose: vi.fn() };
  const host = { editor: { createModel: vi.fn(() => model), create: vi.fn(() => instance), setTheme: vi.fn() } };
  return { state, model, instance, layer, host };
});
vi.mock('./editor', () => ({ ensureAgentScriptMonaco: () => h.host, applyDiagnostics: vi.fn(), setAgentScriptLspDialect: vi.fn() }));
vi.mock('./studio-layer', () => ({ StudioLayer: vi.fn(function () { return h.layer; }) }));

import App from './App.js';
import { ACTION_AGENT } from '../../src/action-fixtures.js';

let post: any;
const send = (data: object) => act(() => { window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window.parent, data: { source, ...data } })); });
const sent = (type: string) => post.mock.calls.map((c: any[]) => c[0] as any).filter((m: any) => m.type === type);

beforeEach(() => {
  h.state.value = '';
  post = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('creates the editor with the studio layer, announces ready and disposes both on unmount', () => {
  const { unmount } = render(<App />);
  expect((h.host.editor.create.mock.calls as any[][])[0]![1]).toEqual(expect.objectContaining({ glyphMargin: true }));
  expect(sent('ready')).toHaveLength(1);
  unmount();
  expect(h.layer.dispose).toHaveBeenCalled();
  expect(h.instance.dispose).toHaveBeenCalled();
});

it('forwards proposal, comment, hit and layout messages to the layer', () => {
  const { getByTestId } = render(<App />);
  send({ type: 'proposeEdit', proposalId: 'p1', content: 'x', summary: 's', actor: 'a' });
  expect(h.layer.setProposal).toHaveBeenCalledWith(expect.objectContaining({ proposalId: 'p1' }));
  send({ type: 'clearProposal', proposalId: 'p1' });
  expect(h.layer.clearProposal).toHaveBeenCalledWith('p1');
  send({ type: 'setComments', comments: [] });
  expect(h.layer.setComments).toHaveBeenCalledWith([]);
  send({ type: 'setHits', lines: [2] });
  expect(h.layer.setHits).toHaveBeenCalledWith([2]);
  expect(getByTestId('agent-script-ide').className).not.toContain('compact');
  send({ type: 'setLayout', compact: true });
  expect(getByTestId('agent-script-ide').className).toContain('compact');
  expect(h.instance.updateOptions).toHaveBeenLastCalledWith({ fontSize: 13, lineNumbers: 'off' });
  send({ type: 'setLayout', compact: false });
  expect(h.instance.updateOptions).toHaveBeenLastCalledWith({ fontSize: 14, lineNumbers: 'on' });
});

it('notifies the layer on file switch and posts snapshots with diagnostics; ignores foreign messages', () => {
  render(<App />);
  window.dispatchEvent(new MessageEvent('message', { origin: 'https://foreign.example', source: window.parent, data: { source, type: 'setHits', lines: [1] } }));
  window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: null, data: { source, type: 'setHits', lines: [1] } }));
  send({ type: 'bogus' });
  expect(h.layer.setHits).not.toHaveBeenCalled();
  send({ type: 'setFile', path: 'a.agent', content: ACTION_AGENT, dialect: 'agentforce', readOnly: false, draftKey: 'k' });
  expect(h.layer.onFileSwitched).toHaveBeenCalled();
  expect(h.model.setValue).toHaveBeenCalledWith(ACTION_AGENT);
  const snap = sent('snapshot').at(-1);
  expect(snap).toEqual(expect.objectContaining({ content: ACTION_AGENT, draftKey: 'k' }));
  expect(Array.isArray(snap.diagnostics)).toBe(true);
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: false }));
  // user edit -> dirty + snapshot
  h.state.value = ACTION_AGENT + '\n# edit';
  act(() => h.state.content!());
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: true }));
  send({ type: 'flushSave' });
  expect(sent('persist').at(-1)).toEqual(expect.objectContaining({ path: 'a.agent' }));
  send({ type: 'saved', sha256: 'abc', draftKey: 'other' });
  send({ type: 'saved', sha256: 'abc', draftKey: 'k', content: h.state.value });
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: false, baseSha: 'abc' }));
  send({ type: 'revealLine', line: 3 });
  expect(h.instance.revealLineInCenter).toHaveBeenCalledWith(3);
  send({ type: 'init', theme: 'light', dialect: 'agentforce', examples: [], files: [], saveEnabled: true, org: null });
  send({ type: 'setOrg', org: null });
  send({ type: 'setTheme', theme: 'dark' });
  send({ type: 'setDialect', dialect: 'agentforce' });
});

it('ctrl-click on a target line opens the matching action', () => {
  render(<App />);
  send({ type: 'setFile', path: 'a.agent', content: ACTION_AGENT, dialect: 'agentforce', readOnly: false });
  const lines = ACTION_AGENT.split('\n');
  const line = lines.findIndex(l => /^\s*target\s*:/.test(l)) + 1;
  expect(line).toBeGreaterThan(0);
  h.state.mouse!({ event: { ctrlKey: false, metaKey: false }, target: { position: { lineNumber: line } } });
  h.state.mouse!({ event: { ctrlKey: true }, target: { position: undefined } });
  h.state.mouse!({ event: { ctrlKey: true }, target: { position: { lineNumber: 1 } } });
  expect(sent('openAction')).toHaveLength(0);
  h.state.mouse!({ event: { metaKey: true }, target: { position: { lineNumber: line } } });
  expect(sent("openAction")).toHaveLength(1);
});
