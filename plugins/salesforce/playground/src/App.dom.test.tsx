/** @vitest-environment happy-dom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { PLAYGROUND_BRIDGE_SOURCE as source } from '../../src/app/playground-bridge.js';

const h = vi.hoisted(() => {
  const state = { value: '', mouse: null as null | ((e: any) => void), content: null as null | (() => void) };
  const model = {
    getValue: () => state.value,
    setValue: vi.fn((v: string) => { state.value = v; state.content?.(); }),
    getFullModelRange: () => ({ full: true }),
    pushEditOperations: vi.fn((_s: unknown, edits: { text: string }[]) => { state.value = edits[0]!.text; state.content?.(); return null; }),
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
import { StudioLayer } from './studio-layer';
import { writeAgentDraft } from '../../src/app/agent-script-drafts.js';
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

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

it('reloads a clean editor when the file changes on disk, as one undoable edit', () => {
  render(<App />);
  send({ type: 'setFile', path: 'a.agent', content: ACTION_AGENT, dialect: 'agentforce', readOnly: false, draftKey: 'k', sha256: SHA_A });
  // Its own version, another file's change and an unchanged sha are no-ops.
  send({ type: 'fileChanged', draftKey: 'other', content: 'x', sha256: SHA_B });
  send({ type: 'fileChanged', draftKey: 'k', content: ACTION_AGENT, sha256: SHA_A });
  expect(h.model.pushEditOperations).not.toHaveBeenCalled();
  const next = ACTION_AGENT.replace('\n', '\n# agent edit\n');
  send({ type: 'fileChanged', draftKey: 'k', content: next, sha256: SHA_B });
  expect(h.model.pushEditOperations).toHaveBeenCalledWith([], [{ range: { full: true }, text: next }], expect.any(Function));
  expect(h.state.value).toBe(next);
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: false, baseSha: SHA_B }));
  expect(sent('snapshot').at(-1)).toEqual(expect.objectContaining({ content: next }));
  expect(h.layer.setProposal).not.toHaveBeenCalled();
});

it('keeps unsaved edits and offers the disk version as a proposal; a save conflicts until it is decided', () => {
  render(<App />);
  const layerPost = (vi.mocked(StudioLayer).mock.calls.at(-1) as unknown[])[2] as (m: Record<string, unknown>) => void;
  send({ type: 'setFile', path: 'a.agent', content: ACTION_AGENT, dialect: 'agentforce', readOnly: false, draftKey: 'k', sha256: SHA_A });
  h.state.value = ACTION_AGENT + '\n# mine';
  act(() => h.state.content!());
  const next = ACTION_AGENT + '\n# theirs';
  send({ type: 'fileChanged', draftKey: 'k', content: next, sha256: SHA_B });
  expect(h.model.pushEditOperations).not.toHaveBeenCalled();
  expect(h.state.value).toBe(ACTION_AGENT + '\n# mine');
  const proposalId = `disk:${'b'.repeat(16)}`;
  expect(h.layer.setProposal).toHaveBeenCalledWith(expect.objectContaining({ proposalId, content: next, actor: 'File changed on disk' }));
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: true, baseSha: SHA_A }));
  // The same version is not offered again on the next check.
  send({ type: 'fileChanged', draftKey: 'k', content: next, sha256: SHA_B });
  expect(h.layer.setProposal).toHaveBeenCalledTimes(1);
  // A proposal closed undecided, or another proposal, leaves the edits on the old version.
  act(() => layerPost({ type: 'proposalResolved', proposalId, note: 'file changed', content: h.state.value }));
  act(() => layerPost({ type: 'proposalResolved', proposalId: 'agent-1', content: h.state.value }));
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ baseSha: SHA_A }));
  expect(sent('proposalResolved')).toHaveLength(2);
  // Rejecting it keeps the edits, now on the new version, so a save goes over it.
  act(() => layerPost({ type: 'proposalResolved', proposalId, outcome: 'rejected', content: h.state.value }));
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: true, baseSha: SHA_B }));
  // A disk version that already matches the edits just settles the draft.
  send({ type: 'fileChanged', draftKey: 'k', content: h.state.value, sha256: SHA_C });
  expect(h.layer.setProposal).toHaveBeenCalledTimes(1);
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: false, baseSha: SHA_C }));
});

it('offers the disk version over a stored draft written against an older one', () => {
  render(<App />);
  send({ type: 'setFile', path: 'a.agent', content: ACTION_AGENT, dialect: 'agentforce', readOnly: false, draftKey: 'k', sha256: SHA_A });
  h.state.value = ACTION_AGENT + '\n# mine';
  act(() => h.state.content!());
  send({ type: 'setFile', path: null, content: '', dialect: 'agentforce', readOnly: true, draftKey: '' });
  const next = ACTION_AGENT + '\n# theirs';
  send({ type: 'setFile', path: 'a.agent', content: next, dialect: 'agentforce', readOnly: false, draftKey: 'k', sha256: SHA_B });
  expect(h.state.value).toBe(ACTION_AGENT + '\n# mine');
  expect(h.layer.setProposal).toHaveBeenCalledWith(expect.objectContaining({ content: next }));
  // Until it is decided, the draft keeps its checksum, so a save cannot overwrite the outside change.
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: true, baseSha: SHA_A }));
  // A stale draft that already matches the disk opens clean on the new version.
  h.layer.setProposal.mockClear();
  writeAgentDraft({ key: 'k', content: next, baseSha: SHA_A, dialect: 'agentforce' });
  send({ type: 'setFile', path: 'a.agent', content: next, dialect: 'agentforce', readOnly: false, draftKey: 'k', sha256: SHA_C });
  expect(h.layer.setProposal).not.toHaveBeenCalled();
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: false, baseSha: SHA_C }));
});

it('setReadOnly locks the editor, shows the holder text without a draft, and edits it back as one undoable edit', () => {
  render(<App />);
  send({ type: 'setFile', draftKey: 'k', path: 'a.agent', content: 'disk', dialect: 'agentforce', readOnly: false, sha256: 'a'.repeat(64) });
  post.mockClear();
  send({ type: 'setReadOnly', readOnly: true, content: 'live from holder' });
  expect(h.instance.updateOptions).toHaveBeenCalledWith({ readOnly: true, domReadOnly: true });
  expect(h.model.setValue).toHaveBeenLastCalledWith('live from holder');
  expect(sent('dirty')).toHaveLength(0); // not published as this window's draft
  expect(sent('snapshot').at(-1)).toEqual(expect.objectContaining({ content: 'live from holder' }));
  send({ type: 'setReadOnly', readOnly: true, content: 'live from holder' }); // unchanged text: no churn
  expect(h.model.setValue).toHaveBeenCalledTimes(2);
  send({ type: 'setReadOnly', readOnly: false, content: 'holder final' });
  expect(h.instance.updateOptions).toHaveBeenLastCalledWith({ readOnly: false, domReadOnly: false });
  expect(h.model.pushEditOperations).toHaveBeenCalled();
  expect(h.state.value).toBe('holder final');
  send({ type: 'setReadOnly', readOnly: false });
  expect(h.model.pushEditOperations).toHaveBeenCalledTimes(1);
});

it('setReadOnly with a baseline re-baselines the draft: drops an offered disk version, publishes, and saves against the new base', () => {
  render(<App />);
  const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
  writeAgentDraft({ key: 'k', content: 'my edits', baseSha: A, dialect: 'agentforce' });
  send({ type: 'setFile', draftKey: 'k', path: 'a.agent', content: 'disk v2', dialect: 'agentforce', readOnly: false, sha256: B });
  expect(h.layer.setProposal).toHaveBeenCalledWith(expect.objectContaining({ proposalId: `disk:${B.slice(0, 16)}` }));
  send({ type: 'setReadOnly', readOnly: true, content: 'holder text' });
  post.mockClear();
  // Unlocked on the shared document's saved version, same text: the draft is republished on that base.
  send({ type: 'setReadOnly', readOnly: false, baseline: 'shared disk', baseSha: C });
  expect(h.layer.clearProposal).toHaveBeenCalledWith(`disk:${B.slice(0, 16)}`);
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: true, baseSha: C }));
  // A later fileChanged at that sha is not offered again.
  h.layer.setProposal.mockClear();
  send({ type: 'fileChanged', draftKey: 'k', content: 'shared disk', sha256: C });
  expect(h.layer.setProposal).not.toHaveBeenCalled();
  // Unlock with new content: the edit goes in as one undoable change and is published on the new base.
  post.mockClear(); h.layer.clearProposal.mockClear();
  send({ type: 'setReadOnly', readOnly: false, content: 'shared disk', baseline: 'shared disk', baseSha: A });
  expect(h.layer.clearProposal).not.toHaveBeenCalled(); // nothing was offered
  expect(h.state.value).toBe('shared disk');
  expect(sent('dirty').at(-1)).toEqual(expect.objectContaining({ dirty: false, baseSha: A }));
  // A follower that is re-baselined publishes nothing.
  post.mockClear();
  send({ type: 'setReadOnly', readOnly: true, baseline: 'x', baseSha: B });
  expect(sent('dirty')).toHaveLength(0);
});
