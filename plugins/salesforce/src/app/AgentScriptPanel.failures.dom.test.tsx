/**
 * @vitest-environment happy-dom
 */
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';

const control: { options?: any } = {};
vi.mock('./useSalesforceControl.js', () => ({ useSalesforceControl: (options: unknown) => { control.options = options; } }));
vi.mock('./preview/PreviewWorkbench.js', () => ({ PreviewWorkbench: () => <div data-testid="stub-preview" /> }));
vi.mock('./studio/AssistantRail.js', () => ({ AssistantRail: () => <div data-testid="stub-assistant" /> }));
vi.mock('./AgentScriptGraphPanel.js', () => ({ AgentScriptGraphPanel: () => <div data-testid="stub-graph" /> }));
vi.mock('./OrgAgentsPanel.js', () => ({ OrgAgentsPanel: () => <div data-testid="stub-agents" /> }));
vi.mock('./AgentforceLabPanel.js', () => ({ AgentforceLabPanel: () => <div data-testid="stub-lab" /> }));
vi.mock('./panels/OperationsPanel.js', () => ({ OperationsPanel: () => <div data-testid="stub-ops" /> }));
const { AgentScriptPanel } = await import('./AgentScriptPanel.js');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise(r => setTimeout(r, 0)); });
const SHA = 'a'.repeat(64);
const SOURCE = 'start_agent:\n  a\n  b\n';
const PATH = 'force-app/bots/QC.agent';
let overrides: Record<string, (args: any) => unknown>;
const rpc = vi.fn(async (_p: string, method: string, args?: any) => {
  if (overrides[method]) return overrides[method]!(args);
  if (method === 'status') return { dxProject: true, agentScriptDialect: 'agentforce', projectRoot: '/proj' };
  if (method === 'agentFiles.list') return { ok: true, files: [{ apiName: 'QC', path: PATH, lines: 4 }] };
  if (method === 'org') return { ok: true, org: { alias: 'dev', username: 'd@x.com', orgId: '00D', instanceUrl: 'https://x', apiVersion: '62.0', kind: 'sandbox', isDefault: true } };
  if (method === 'orgs') return { ok: true, selectedAlias: 'dev', orgs: [] };
  if (method === 'agentFiles.read') return { ok: true, file: { path: args?.path, content: SOURCE, sha256: SHA } };
  if (method === 'agentFiles.write') return { ok: true, file: { path: args?.path, sha256: 'sha2' } };
  if (method === 'studio.explorer') return { ok: true, nodes: [] };
  if (method === 'studio.suites.list') return { ok: true, suites: [] };
  if (method === 'studio.comments.list') return { ok: true, comments: [] };
  if (method === 'studio.comments.add') return { ok: true };
  if (method === 'studio.askAgent') return { ok: true, threadId: 't1' };
  return { ok: false };
});
const roots: Array<() => void> = [];
let current: { root: Root; el: HTMLElement } | null = null;
const render = (params?: unknown) => createElement(AgentScriptPanel, { pluginId: 'salesforce', subPath: PATH, params, projectId: 'proj-1', orgPicker: false });

async function mount(params?: unknown) {
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(() => { root.unmount(); el.remove(); });
  current = { root, el };
  await act(async () => { root.render(render(params)); });
  await flush();
  return el;
}
const post = async (el: HTMLElement, data: Record<string, unknown>) => {
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: el.querySelector('iframe')!.contentWindow, data: { source: PLAYGROUND_BRIDGE_SOURCE, ...data } })); });
  await flush();
};
const ready = (el: HTMLElement) => post(el, { type: 'ready' });
const exec = (command: string, input: Record<string, unknown> = {}) => control.options.execute({ id: 'c1', command, input });
const alert = (el: HTMLElement) => el.querySelector('[role="alert"]')?.textContent ?? '';

beforeEach(() => {
  localStorage.clear(); rpc.mockClear(); overrides = {};
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: 1000, height: 600, top: 0, left: 0, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  (globalThis as any).ResizeObserver = class { constructor(private cb: any) {} observe() { this.cb([{ contentRect: { width: 1000 } }]); } disconnect() {} };
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
    const self = this as any;
    return self.__win ??= Object.assign(Object.create(window), { postMessage: vi.fn() });
  });
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc, useZccNavigate: () => ({ toCompose: vi.fn() }), getSettings: async () => ({ values: { agentScriptDialect: 'agentforce' } }), setSettings: async () => undefined };
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = {
    useZccNavigate: () => ({ toCompose: vi.fn() }),
    useSettings: () => ({ values: { agentScriptDialect: 'agentforce', defaultOrg: 'dev' }, isLoading: false }),
    useRealtime: () => undefined
  };
});
afterEach(() => { roots.splice(0).forEach(fn => fn()); current = null; vi.restoreAllMocks(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; });

describe('AgentScriptPanel failure paths', () => {
  it('shows a save conflict, then recovers on the next save', async () => {
    const el = await mount();
    await ready(el);
    overrides['agentFiles.write'] = () => ({ ok: false, error: 'The file changed on disk (sha mismatch).' });
    await post(el, { type: 'persist', path: PATH, content: 'changed' });
    expect(alert(el)).toContain('sha mismatch');
    overrides['agentFiles.write'] = () => { throw new Error('network down'); };
    await post(el, { type: 'persist', path: PATH, content: 'changed' });
    expect(alert(el)).toContain('network down');
    overrides['agentFiles.write'] = () => ({ ok: false });
    await post(el, { type: 'persist', path: PATH, content: 'changed' });
    expect(alert(el)).toContain('Save failed.');
    delete overrides['agentFiles.write'];
    await post(el, { type: 'persist', path: PATH, content: 'changed' });
    expect(alert(el)).toBe('');
  });

  it('settles a superseded proposal as rejected and tolerates unknown resolutions', async () => {
    const el = await mount();
    await ready(el);
    const first = await exec('editor.proposeEdit', { path: PATH, expectedSha256: SHA, summary: 's', content: 'one' }) as any;
    const second = await exec('editor.proposeEdit', { path: PATH, expectedSha256: SHA, summary: 's', content: 'two' }) as any;
    await post(el, { type: 'proposalResolved', proposalId: first.proposalId, content: SOURCE, outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 1, note: 'Superseded by a newer proposal.' });
    await expect(first.settled).resolves.toMatchObject({ outcome: 'rejected', note: 'Superseded by a newer proposal.' });
    await post(el, { type: 'proposalResolved', proposalId: 'unknown', content: SOURCE, outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 0 });
    await post(el, { type: 'proposalResolved', proposalId: second.proposalId, content: 'two', outcome: 'accepted', acceptedHunks: 1, rejectedHunks: 0, sha256: SHA });
    await expect(second.settled).resolves.toMatchObject({ outcome: 'accepted', acceptedHunks: 1, sha256: SHA });
  });

  it('rejects pending proposals when the editor closes', async () => {
    const el = await mount();
    await ready(el);
    const { settled } = await exec('editor.proposeEdit', { path: PATH, expectedSha256: SHA, summary: 's', content: 'one' }) as any;
    act(() => current!.root.unmount());
    await expect(settled).resolves.toMatchObject({ outcome: 'rejected', note: expect.stringMatching(/closed/) });
    current!.root = createRoot(current!.el);
  });

  it('survives a comments list failure and reports add-comment failures', async () => {
    overrides['studio.comments.list'] = () => { throw new Error('comments offline'); };
    const el = await mount();
    await ready(el);
    expect(alert(el)).toBe('');
    await post(el, { type: 'commentAction', kind: 'add', line: 2, endLine: 3, quote: 'a\nb' });
    const submit = async (body: string) => {
      const textarea = el.querySelector('form[aria-label="Add comment"] textarea') as HTMLTextAreaElement;
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, body); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
      await act(async () => { (el.querySelector('form[aria-label="Add comment"]') as HTMLFormElement).requestSubmit(); });
      await flush();
    };
    overrides['studio.comments.add'] = () => ({ ok: false, error: 'Comment store unavailable.' });
    await submit('please fix');
    expect(alert(el)).toContain('Comment store unavailable.');
    await post(el, { type: 'commentAction', kind: 'add', line: 2, endLine: 2, quote: 'a' });
    overrides['studio.comments.add'] = () => { throw new Error('add exploded'); };
    await submit('again');
    expect(alert(el)).toContain('add exploded');
    expect(rpc.mock.calls.filter(c => c[1] === 'studio.comments.add')).toHaveLength(2);
  });

  it('keeps working when the explorer RPC fails', async () => {
    overrides['studio.explorer'] = () => { throw new Error('explorer offline'); };
    const el = await mount();
    await ready(el);
    expect(el.querySelector('iframe')).toBeTruthy();
    expect(alert(el)).toBe('');
    expect(rpc.mock.calls.some(c => c[1] === 'studio.explorer')).toBe(true);
  });

  it('reports ask-agent, status, listing and read failures', async () => {
    overrides['studio.askAgent'] = () => ({ ok: false, error: 'No agent thread available.' });
    overrides['agentFiles.read'] = () => ({ ok: false, error: 'Could not read it.' });
    const el = await mount();
    await ready(el);
    expect(alert(el)).toContain('Could not read it.');
    overrides['agentFiles.read'] = () => ({ ok: false });
    await post(el, { type: 'requestOpen', path: PATH });
    expect(alert(el)).toContain('Could not read Agentforce file.');
    await post(el, { type: 'askSelection', action: 'explain', startLine: 1, endLine: 2, text: 'a' });
    expect(alert(el)).toContain('No agent thread available.');
    await post(el, { type: 'askSelection', action: 'preview-topic', startLine: 1, endLine: 2, text: 'a' });
    expect(el.querySelector('[data-testid="stub-preview"]')).toBeTruthy();
  });

  it('reports status and file-list RPC failures', async () => {
    overrides.status = () => { throw new Error('status offline'); };
    overrides['agentFiles.list'] = () => { throw new Error('list offline'); };
    const el = await mount();
    expect(alert(el)).toMatch(/offline/);
  });

  it('applies changed panel params (line, tool and dependency focus) after mount', async () => {
    const el = await mount({ path: PATH, line: 2 });
    await ready(el);
    const rerender = async (params: unknown) => { await act(async () => { current!.root.render(render(params)); }); await flush(); };
    await rerender({ path: PATH, line: 3 });
    await rerender({ path: PATH, tool: 'graph' });
    expect(el.querySelector('[data-testid="stub-graph"]')).toBeTruthy();
    await rerender({ path: PATH, apiName: 'Foo', readOnly: 'true' });
    await rerender({ path: PATH, apiName: 'Create_Return' });
    await rerender({});
    expect(el.querySelector('iframe')).toBeTruthy();
  });
});
