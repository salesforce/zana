/**
 * @vitest-environment happy-dom
 */
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';

const control: { options?: any } = {};
vi.mock('./useSalesforceControl.js', () => ({ useSalesforceControl: (options: unknown) => { control.options = options; } }));
vi.mock('./preview/PreviewWorkbench.js', () => ({ PreviewWorkbench: (p: any) => <div data-testid="stub-preview" data-engine={p.engine} data-dirty={String(Boolean(p.dirty))} data-command={p.command ? JSON.stringify(p.command) : ""}><button data-testid="stub-run" onClick={() => p.onRunChange({ runId: 'r1', engine: 'live', turn: 1 })}>run</button><button data-testid="stub-handled" onClick={() => p.onCommandHandled(p.command?.seq ?? -1)}>handled</button><button data-testid="stub-stale" onClick={() => p.onCommandHandled(0)}>stale</button></div> }));
vi.mock('./studio/AskAgentButton.js', () => ({ AskAgentButton: () => <div data-testid="stub-ask-agent" /> }));
vi.mock('./AgentScriptGraphPanel.js', () => ({ AgentScriptGraphPanel: (p: any) => <div data-testid="stub-graph" data-focus={`${p.focusNode}:${p.focusSeq}`} data-compact={String(p.compact)} /> }));
vi.mock('./OrgAgentsPanel.js', () => ({ OrgAgentsPanel: () => <div data-testid="stub-agents" /> }));
vi.mock('./AgentforceLabPanel.js', () => ({ AgentforceLabPanel: () => <div data-testid="stub-lab" /> }));
vi.mock('./panels/OperationsPanel.js', () => ({ OperationsPanel: () => <div data-testid="stub-ops" /> }));
vi.mock('./studio/OrgTestsView.js', () => ({ OrgTestsView: (p: any) => <div data-testid="stub-org-tests" data-visible={String(p.visible)} data-focus={p.focus ? JSON.stringify(p.focus) : ''}><button data-testid="stub-org-tests-handled" onClick={() => p.onFocusHandled?.(p.focus?.seq ?? -1)}>handled</button></div> }));
const { AgentScriptPanel } = await import('./AgentScriptPanel.js');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise(r => setTimeout(r, 0)); });
let width = 1000;
const observers: Array<(w: number) => void> = [];
const SHA = 'a'.repeat(64);
const SOURCE = 'start_agent:\n  a\n  b\n';
const baseRpc = async (_p: string, method: string, args?: any): Promise<unknown> => {
  if (method === 'status') return { dxProject: true, agentScriptDialect: 'agentforce', projectRoot: '/proj' };
  if (method === 'agentFiles.list') return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }, { apiName: 'Help', path: 'force-app/bots/Help.agent', lines: 4 }] };
  if (method === 'org') return { ok: true, org: { alias: 'dev', username: 'd@x.com', orgId: '00D', instanceUrl: 'https://x', apiVersion: '62.0', kind: 'sandbox', isDefault: true } };
  if (method === 'orgs') return { ok: true, selectedAlias: 'dev', orgs: [] };
  if (method === 'agentFiles.read') return { ok: true, file: { path: args?.path, content: SOURCE, sha256: SHA } };
  if (method === 'agentFiles.write') return { ok: true, file: { path: args?.path, sha256: 'sha2' } };
  if (method === 'studio.explorer') return { ok: true, nodes: [{ kind: 'agent', path: 'force-app/bots/QC.agent', apiName: 'QC' }, { kind: 'apex', apiName: 'Foo', path: 'force-app/classes/Foo.cls', usedBy: ['force-app/bots/QC.agent'] }, { kind: 'scenario', path: 'tests/a.scenario.json', apiName: 'a' }, { kind: 'org-agent', apiName: 'OrgBot' }] };
  if (method === 'studio.suites.list') return { ok: true, suites: [{ id: 's', path: 'tests/a.scenario.json', cases: [], lastResults: { x: { outcome: 'fail', runId: 'r', at: 1 } } }] };
  if (method === 'studio.comments.list') return { ok: true, comments: [] };
  if (method === 'studio.comments.add') return { ok: true };
  if (method === 'studio.askAgent') return { ok: true, threadId: 't1' };
  if (method === 'release.state') return { ok: true, data: { org: { alias: 'dev', orgId: '00D', kind: 'sandbox' }, agent: { apiName: 'QC', path: args?.path, revision: SHA, versioned: false, lastPublish: null }, needsReadApproval: false, readUntil: null, versions: [] } };
  return { ok: false };
};
const rpc = vi.fn(baseRpc);
let realtime: ((p: unknown) => void) | undefined;
const nodes: Array<() => void> = [];

async function mount(arg: string | { subPath?: string; params?: unknown; threadId?: string } = {}, extra: { params?: unknown } = {}) {
  const props = typeof arg === 'string' ? { subPath: arg, ...extra } : arg;
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  nodes.push(() => { root.unmount(); el.remove(); });
  await act(async () => { root.render(createElement(AgentScriptPanel, { pluginId: 'salesforce', subPath: props.subPath ?? '', params: props.params, projectId: 'proj-1', orgPicker: false, ...('threadId' in props && props.threadId ? { threadId: props.threadId } : {}) })); });
  await flush();
  return el;
}
const post = async (el: HTMLElement, data: Record<string, unknown>) => {
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: el.querySelector('iframe')!.contentWindow, data: { source: PLAYGROUND_BRIDGE_SOURCE, ...data } })); });
  await flush();
};
const ready = (el: HTMLElement) => post(el, { type: 'ready' });
const resize = async (w: number) => { width = w; await act(async () => { observers.forEach(cb => cb(w)); }); };
const exec = (command: string, input: Record<string, unknown> = {}) => control.options.execute({ id: 'c1', command, input });
const sent = (el: HTMLElement) => (el.querySelector('iframe')!.contentWindow!.postMessage as any).mock.calls.map((c: any[]) => c[0]);

beforeEach(() => {
  localStorage.clear(); rpc.mockClear(); observers.length = 0; width = 1000; realtime = undefined;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  (globalThis as any).ResizeObserver = class { constructor(cb: any) { observers.push(w => cb([{ contentRect: { width: w } }])); } observe() {} disconnect() {} };
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
    const self = this as any;
    return self.__win ??= Object.assign(Object.create(window), { postMessage: vi.fn() });
  });
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc, useZccNavigate: () => ({ toCompose: vi.fn() }), getSettings: async () => ({ values: { agentScriptDialect: 'agentforce' } }), setSettings: async () => undefined };
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = {
    useZccNavigate: () => ({ toCompose: vi.fn() }),
    useSettings: () => ({ values: { agentScriptDialect: 'agentforce', defaultOrg: 'dev' }, isLoading: false }),
    useRealtime: (_c: string, h: (p: unknown) => void) => { realtime = h; }
  };
});
afterEach(() => { nodes.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; });

const openReferences = async (root: ParentNode) => { const btn = [...root.querySelectorAll('.sf-as-explorer-foot button')][0]; expect(btn).toBeTruthy(); await act(async () => { fireEvent.click(btn!); }); };
describe('AgentScriptPanel studio layout', () => {
  it('wires current-case failure counts, saved evidence and Open Tests into the footer', async () => {
    rpc.mockImplementation(async (plugin, method, args) => method === 'studio.suites.list' ? {
      ok: true, suites: [{ id: 'QC', path: 'tests/QC.scenario.json',
        cases: ['fail', 'pass', 'pending'].map(id => ({ id, name: `Footer ${id}`, utterances: ['Hello'], expect: { contains: ['evidence'] } })),
        lastResults: { fail: { outcome: 'fail', runId: '', at: 1, reply: 'Hello', notes: ['Missing text: "evidence"'] }, pass: { outcome: 'pass', runId: '', at: 1, reply: 'Here is the evidence' }, removed: { outcome: 'fail', runId: '', at: 1 } }
      }]
    } : baseRpc(plugin, method, args));
    try {
      const el = await mount('force-app/bots/QC.agent');
      await ready(el);
      await act(async () => { fireEvent.click(within(el).getByRole('tab', { name: 'Tests 1', exact: true })); });
      const footer = within(el.querySelector<HTMLElement>('[aria-label="Saved scenario results"]')!);
      expect(footer.getByText('1 failed')).toBeTruthy();
      expect(el.querySelector('.sf-footer-tests-summary')!.textContent).toContain('1 not run');
      const suite = el.querySelector<HTMLDetailsElement>('.sf-footer-tests details')!;
      await act(async () => { suite.open = true; fireEvent(suite, new Event('toggle')); });
      await act(async () => { fireEvent.click(footer.getByRole('button', { name: 'Footer fail', exact: true })); });
      expect(footer.getByRole('region', { name: 'Details for Footer fail' }).textContent).toContain('Actual: Not in the reply');
      await act(async () => { fireEvent.click(footer.getByRole('button', { name: 'Open Tests', exact: true })); });
      expect(within(el).getByTestId('studio-view-tests').style.display).not.toBe('none');
    } finally { rpc.mockImplementation(baseRpc); }
  });

  it('renders the wide IDE layout and keeps the iframe across tier changes', async () => {
    const el = await mount('force-app/bots/QC.agent');
    const root = el.querySelector('.sf-studio')!;
    expect(root.getAttribute('data-layout')).toBe('wide');
    const iframe = el.querySelector('iframe');
    await ready(el);
    expect(el.querySelector('[data-testid="salesforce-agent-script-explorer"]')).toBeTruthy();
    expect([...el.querySelectorAll('[aria-label="Studio activity"] button')].map(button => button.getAttribute('aria-label'))).toEqual(['Files', 'Tests', 'Go to file']);
    expect(el.querySelector('[data-testid="stub-ask-agent"]')).toBeTruthy();
    expect(el.querySelector('[role="tablist"][aria-label]')).toBeTruthy();
    expect(el.textContent).toContain('Problems');
    expect(sent(el).some((m: any) => m.type === 'setLayout' && m.compact === false)).toBe(true);
    await resize(500);
    expect(el.querySelector('.sf-studio')!.getAttribute('data-layout')).toBe('compact');
    expect(el.querySelector('iframe')).toBe(iframe);
    expect(el.querySelector('[data-testid="stub-ask-agent"]')).toBeTruthy();
    expect(sent(el).some((m: any) => m.type === 'setLayout' && m.compact === true)).toBe(true);
    await resize(1000);
    expect(el.querySelector('iframe')).toBe(iframe);
    await resize(300);
    expect(el.querySelector('.sf-studio')!.getAttribute('data-tier')).toBe('0');
  });

  it('follows the thread it sits beside, then whichever agent drives it, with a pause', async () => {
    const el = await mount({ subPath: 'force-app/bots/QC.agent', threadId: 'owner' });
    await ready(el);
    const chip = () => el.querySelector('[data-testid="salesforce-follow-chip"]')!;
    expect(chip().textContent).toContain('Following this thread');
    expect(control.options.threadId).toBe('owner');
    // A side-panel conversation drives the Studio through the same control lease.
    await act(async () => { await control.options.execute({ id: 'c2', command: 'editor.reveal', input: { line: 2 }, from: { threadId: 'panel-1', title: 'Review · QC.agent' } }); });
    await flush();
    expect(chip().textContent).toContain('Following Review · QC.agent');
    await act(async () => { fireEvent.click(chip()); });
    expect(chip().textContent).toContain('Following paused');
    expect(chip().getAttribute('aria-pressed')).toBe('false');
    await act(async () => { await control.options.execute({ id: 'c3', command: 'editor.reveal', input: { line: 3 }, from: { threadId: 'panel-1', title: 'Review · QC.agent' } }); });
    await flush();
    expect(el.querySelector('[data-testid="salesforce-follow-toast"]')!.textContent).toContain('Review · QC.agent');
    await act(async () => { fireEvent.click(chip()); });
    expect(chip().textContent).toContain('Following Review · QC.agent');
  });

  it('shows no follow chip until something drives the Studio', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    expect(el.querySelector('[data-testid="salesforce-follow-chip"]')).toBeNull();
  });

  it('switches compact tools and quick opens files with Cmd+P', async () => {
    width = 500;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const strip = el.querySelector('[aria-label="Studio tools"]')!;
    const tab = (name: RegExp) => [...strip.querySelectorAll('[role="tab"]')].find(t => name.test(t.getAttribute('aria-label') ?? t.textContent ?? ''))!;
    await act(async () => { fireEvent.click(tab(/preview/i)); });
    expect(el.querySelector('[data-testid="stub-preview"]')).toBeTruthy();
    await act(async () => { fireEvent.click(tab(/graph/i)); });
    expect(el.querySelector('[data-testid="stub-graph"]')!.getAttribute('data-compact')).toBe('true');
    await act(async () => { fireEvent.click(tab(/code/i)); });
    await act(async () => { fireEvent.keyDown(el.querySelector('.sf-studio')!, { key: 'p', ctrlKey: true }); });
    const item = [...document.querySelectorAll('[role="option"], li, button')].find(n => n.textContent?.includes('Help'));
    expect(item).toBeTruthy();
    await act(async () => { fireEvent.click(item!); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/Help.agent' }));
  });

  it('saves with Cmd+S through flushSave and de-duplicates the bridge request', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    el.querySelector('iframe')!.contentWindow!.postMessage = vi.fn();
    await act(async () => { fireEvent.keyDown(el.querySelector('.sf-studio')!, { key: 's', metaKey: true }); });
    await post(el, { type: 'saveRequest' });
    expect(sent(el).filter((m: any) => m.type === 'flushSave')).toHaveLength(1);
  });

  it('sends the open file to the editor when it changes on disk', async () => {
    const intervals: Array<{ fn: () => void; ms?: number }> = [];
    const realInterval = window.setInterval.bind(window);
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void, ms?: number) => { intervals.push({ fn, ms }); return realInterval(() => undefined, 1_000_000); }) as typeof window.setInterval);
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const changes = () => sent(el).filter((m: any) => m.type === 'fileChanged');
    const reads = () => rpc.mock.calls.filter(c => c[1] === 'agentFiles.read').length;
    // The editor reports the version it holds; the same sha on disk sends nothing.
    await post(el, { type: 'dirty', dirty: false, draftKey: sent(el).find((m: any) => m.type === 'setFile' && m.path)!.draftKey, baseSha: SHA });
    await act(async () => { realtime?.({ kind: 'files', projectId: 'proj-1', path: 'force-app/bots/QC.agent' }); });
    await flush();
    expect(changes()).toHaveLength(0);
    // Another file's write, or another project's, does not read this one.
    const before = reads();
    await act(async () => { realtime?.({ kind: 'files', projectId: 'proj-1', path: 'force-app/bots/Help.agent' }); realtime?.({ kind: 'files', projectId: 'other', path: 'force-app/bots/QC.agent' }); });
    await flush();
    expect(reads()).toBe(before);
    // An agent's write: the new version goes to the editor under the open draft key.
    const NEXT = 'b'.repeat(64);
    rpc.mockImplementation(async (p: string, method: string, args?: any) => method === 'agentFiles.read' ? { ok: true, file: { path: args?.path, content: 'start_agent:\n  z\n', sha256: NEXT } } : baseRpc(p, method, args));
    await act(async () => { realtime?.({ kind: 'files', projectId: 'proj-1', path: 'force-app/bots/QC.agent' }); });
    await flush();
    expect(changes().at(-1)).toEqual(expect.objectContaining({ content: 'start_agent:\n  z\n', sha256: NEXT, draftKey: expect.stringContaining('file:force-app/bots/QC.agent') }));
    // A native edit is caught by the poll, focus and visibility checks; a failed read just waits for the next one.
    const poll = intervals.find(row => row.ms === 2500)!;
    expect(poll).toBeTruthy();
    rpc.mockImplementation(async (p: string, method: string, args?: any) => { if (method === 'agentFiles.read') throw Error('offline'); return baseRpc(p, method, args); });
    await act(async () => { poll.fn(); });
    await flush();
    expect(changes()).toHaveLength(1);
    rpc.mockImplementation(async (p: string, method: string, args?: any) => method === 'agentFiles.read' ? { ok: false } : baseRpc(p, method, args));
    await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(changes()).toHaveLength(1);
    rpc.mockImplementation(baseRpc);
  });

  it('handles comment and ask-selection requests from the editor', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await post(el, { type: 'cursor', line: 2, column: 3, selection: { startLine: 2, endLine: 2, text: 'a' } });
    // The comment box lives in the editor; the host only stores what it submits.
    await post(el, { type: 'commentAction', kind: 'submit', line: 2, endLine: 3, quote: 'a b', body: ' Needs work ' });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.comments.add', expect.objectContaining({ projectId: 'proj-1', body: 'Needs work', line: 2, endLine: 3, quote: 'a b' }));
    expect(el.querySelector('form[aria-label="Add comment"]')).toBeNull();
    await post(el, { type: 'commentAction', kind: 'open', line: 1, endLine: 1, quote: '' });
    await post(el, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 'a' });
    expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent')).toBe(true);
    await post(el, { type: 'askSelection', action: 'preview-topic', startLine: 1, endLine: 2, text: 'a' });
    expect(el.querySelector('[data-testid="stub-preview"]')).toBeTruthy();
    await act(async () => { realtime?.({ kind: 'comments', projectId: 'proj-1' }); });
    expect(rpc.mock.calls.filter(c => c[1] === 'studio.comments.list').length).toBeGreaterThan(0);
    expect(sent(el).some((m: any) => m.type === 'setComments')).toBe(true);
  });

  it('runs an agent edit proposal to resolution', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0 });
    const result = await act(async () => exec('editor.proposeEdit', { path: 'force-app/bots/QC.agent', expectedSha256: SHA, summary: 'tweak', edits: [{ startLine: 2, endLine: 2, text: '  z' }] }));
    const { proposalId, settled } = result as any;
    expect(sent(el).find((m: any) => m.type === 'proposeEdit')).toMatchObject({ proposalId, content: 'start_agent:\n  z\n  b\n', summary: 'tweak' });
    await post(el, { type: 'proposalResolved', proposalId, outcome: 'accepted', acceptedHunks: 1, rejectedHunks: 0, content: 'start_agent:\n  z\n  b\n', sha256: 'sha9' });
    await expect(settled).resolves.toMatchObject({ outcome: 'accepted', acceptedHunks: 1, sha256: 'sha9' });
  });

  it('rejects a pending proposal when the file switches and a stale-sha proposal fails', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await expect(exec('editor.proposeEdit', { path: 'force-app/bots/QC.agent', expectedSha256: 'b'.repeat(64), summary: 's', content: 'x' })).rejects.toThrow(/changed/);
    const { settled } = await exec('editor.proposeEdit', { path: 'force-app/bots/QC.agent', expectedSha256: SHA, summary: 's', content: 'x' }) as any;
    await post(el, { type: 'requestOpen', path: 'force-app/bots/Help.agent' });
    await expect(settled).resolves.toMatchObject({ outcome: 'rejected' });
  });

  it('drops a preview command once it is handled, so reopening Preview never replays it', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const stub = () => el.querySelector('[data-testid="stub-preview"]')!;
    await act(async () => { await exec('preview.send', { text: 'hi', engine: 'simulate' }); });
    expect(JSON.parse(stub().getAttribute('data-command')!)).toMatchObject({ seq: 1, type: 'send', text: 'hi' });
    // A stale seq leaves a newer command in place.
    await act(async () => { fireEvent.click(stub().querySelector('[data-testid="stub-stale"]')!); });
    expect(JSON.parse(stub().getAttribute('data-command')!)).toMatchObject({ seq: 1 });
    await act(async () => { fireEvent.click(stub().querySelector('[data-testid="stub-handled"]')!); });
    expect(stub().getAttribute('data-command')).toBe('');
    await act(async () => { await exec('preview.start', {}); });
    // The seq keeps counting after a drop, so a remounted panel never mistakes it for one it already ran.
    expect(JSON.parse(stub().getAttribute('data-command')!)).toMatchObject({ seq: 2, type: 'start' });
    expect(stub().getAttribute('data-dirty')).toBe('false');
  });

  it('resolves context presets for preview.start and context.set, and fills the Context tab', async () => {
    const preset = { id: 'p1', name: 'Gold', revision: 2, updatedAt: 1, values: [{ name: 'tier', type: 'Text', value: 'gold' }], fields: [] };
    rpc.mockImplementation(async (p, method, args) => method === 'agentPreview.presets.list' ? { ok: true, scopeKey: 's', presets: [preset] } : baseRpc(p, method, args));
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const command = () => JSON.parse(el.querySelector('[data-testid="stub-preview"]')!.getAttribute('data-command')!);
    let result: unknown;
    await act(async () => { result = await exec('preview.start', { presetId: 'p1' }); });
    expect(result).toEqual({ presetId: 'p1', preset: 'Gold' });
    expect(command()).toMatchObject({ type: 'start', preset: { id: 'p1' } });
    expect(rpc.mock.calls.find(c => c[1] === 'agentPreview.presets.list')![2]).toMatchObject({ path: 'force-app/bots/QC.agent', orgAlias: 'dev' });
    await act(async () => { result = await exec('context.set', { presetId: 'p1' }); });
    expect(result).toEqual({ context: 'preset', presetId: 'p1', preset: 'Gold', variables: 1 });
    expect(command()).toMatchObject({ type: 'context', preset: { id: 'p1' } });
    const values = [{ name: 'tier', type: 'Text', value: 'silver' }];
    await act(async () => { result = await exec('context.set', { values, merge: true }); });
    expect(result).toEqual({ context: 'merged', variables: 1 });
    expect(command()).toMatchObject({ type: 'context', contextVariables: values, merge: true });
    await act(async () => { result = await exec('context.set', { values }); });
    expect(result).toEqual({ context: 'replaced', variables: 1 });
    await expect(exec('context.set', { presetId: 'nope' })).rejects.toThrow(/No context preset nope .*contextPresets\.list/);
    rpc.mockImplementation(async (p, method, args) => method === 'agentPreview.presets.list' ? { ok: false, error: 'Store down' } : baseRpc(p, method, args));
    await expect(exec('preview.start', { presetId: 'p1' })).rejects.toThrow('Store down');
    rpc.mockImplementation(baseRpc);
  });

  it('refuses a context preset before an agent is open', async () => {
    await mount();
    await expect(exec('context.set', { presetId: 'p1' })).rejects.toThrow('Open an agent before using a context preset.');
  });

  it('wires preview, trace, graph and layout command targets', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await exec('preview.start', { engine: 'simulate' }); });
    expect(el.querySelector('[data-testid="stub-preview"]')!.getAttribute('data-engine')).toBe('simulate');
    expect(JSON.parse(el.querySelector('[data-testid="stub-preview"]')!.getAttribute('data-command')!)).toMatchObject({ seq: 1, type: 'start', engine: 'simulate' });
    await act(async () => { await exec('preview.send', { text: 'hi', engine: 'live' }); });
    const stub = el.querySelector('[data-testid="stub-preview"]')!;
    expect(stub.getAttribute('data-engine')).toBe('live');
    expect(JSON.parse(stub.getAttribute('data-command')!)).toMatchObject({ seq: 2, type: 'send', text: 'hi', engine: 'live' });
    await expect(exec('preview.send', { text: '  ' })).rejects.toThrow(/Provide text/);
    await act(async () => { await exec('trace.focus', {}); });
    expect(el.querySelector('[data-testid="studio-trace-pane"]')).toBeTruthy();
    await act(async () => { await exec('graph.focus', { node: 'topic.main' }); });
    expect(el.querySelector('[data-testid="stub-graph"]')!.getAttribute('data-focus')).toBe('topic.main:1');
    await act(async () => { await exec('layout.set', { compact: true }); });
    expect(sent(el).filter((m: any) => m.type === 'setLayout').pop()).toMatchObject({ compact: true });
    await act(async () => { await exec('layout.set', { compact: false }); });
    expect(sent(el).filter((m: any) => m.type === 'setLayout').pop()).toMatchObject({ compact: false });
    await act(async () => { await exec('editor.reveal', { line: 2 }); });
    expect(control.options.state().layout).toBeDefined();
  });

  it('opens Org tests from the activity rail and from orgTests.open, as a kept-mounted editor tab', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    expect(control.options.commands).toContain('orgTests.open');
    const rail = el.querySelector('[aria-label="Studio activity"]')!;
    await act(async () => { fireEvent.click(rail.querySelector('[aria-label="Tests"]')!); });
    await flush();
    const stubView = () => el.querySelector('[data-testid="stub-org-tests"]')!;
    expect([...el.querySelectorAll('[role="tab"] .sf-etab-name')].map(tab => tab.textContent)).toContain('Tests');
    expect(stubView().getAttribute('data-visible')).toBe('true');
    expect(stubView().getAttribute('data-focus')).toBe('');
    // The view brings its own title bar, so the host adds none.
    expect(el.querySelector('[data-testid="studio-org-tests-view"] > section.sf-tp.is-org-tests')).toBeTruthy();
    expect(el.querySelector('[data-testid="studio-org-tests-view"] .sf-tp-head')).toBeNull();
    expect(el.querySelector('[data-testid="studio-org-agents-view"]')).toBeNull();

    // Back on the agent the tab stays mounted, hidden; an agent's orgTests.open brings it back on a run.
    await act(async () => { fireEvent.click([...el.querySelectorAll('.sf-etabs [role="tab"]')].find(tab => tab.textContent?.includes('Script'))!); });
    await flush();
    expect(stubView().getAttribute('data-visible')).toBe('false');
    let reply: unknown;
    await act(async () => { reply = await exec('orgTests.open', { runId: '4KB000000000001AAA' }); });
    await flush();
    expect(reply).toEqual({ runId: '4KB000000000001AAA' });
    expect(stubView().getAttribute('data-visible')).toBe('true');
    expect(JSON.parse(stubView().getAttribute('data-focus')!)).toEqual({ runId: '4KB000000000001AAA', seq: 1 });
    await act(async () => { fireEvent.click(el.querySelector('[data-testid="stub-org-tests-handled"]')!); });
    expect(stubView().getAttribute('data-focus')).toBe('');
    // A bare open keeps the next request's seq counting.
    await act(async () => { await exec('orgTests.open', {}); });
    expect(stubView().getAttribute('data-focus')).toBe('');
    await act(async () => { await exec('orgTests.open', { name: 'Support_Regression' }); });
    expect(JSON.parse(stubView().getAttribute('data-focus')!)).toEqual({ name: 'Support_Regression', seq: 2 });
    // Closing the tab unmounts the view (and keeps the saved layout from carrying it into the next mount).
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="Close Tests"]')!); });
    await flush();
    expect(el.querySelector('[data-testid="stub-org-tests"]')).toBeNull();
  });

  it('a late editor ready re-sends the loaded agent without stealing focus from Tests', async () => {
    // Mount with no initial path: a detached Studio window the user navigates by hand.
    const el = await mount();
    await ready(el);
    // Open an agent from the explorer so a file is loaded (activePath set), with no agent tab in front yet.
    const entry = [...el.querySelectorAll<HTMLElement>('[data-testid="salesforce-agent-script-explorer"] button')].find(n => n.textContent?.includes('QC'))!;
    await act(async () => { fireEvent.click(entry); });
    await flush();
    const agentTab = () => [...el.querySelectorAll('.sf-etabs [role="tab"]')].find(tab => tab.querySelector('.sf-etab-name')?.textContent === 'Script');
    // Move to the Tests target tab, as the user does before the editor settles.
    const rail = el.querySelector('[aria-label="Studio activity"]')!;
    await act(async () => { fireEvent.click(rail.querySelector('[aria-label="Tests"]')!); });
    await flush();
    const orgTab = () => [...el.querySelectorAll('.sf-etabs [role="tab"]')].find(tab => tab.querySelector('.sf-etab-name')?.textContent === 'Tests')!;
    expect(orgTab().getAttribute('aria-selected')).toBe('true');
    const iframe = el.querySelector('iframe')!;
    (iframe.contentWindow!.postMessage as any).mockClear();
    // A late editor ready must re-send the loaded file (so the editor is not left blank) but must not
    // reopen/select its agent tab and steal focus back from Tests.
    await ready(el);
    const files = sent(el).filter((m: any) => m.type === 'setFile' && m.path === 'force-app/bots/QC.agent');
    expect(files.length).toBeGreaterThan(0);
    expect(orgTab().getAttribute('aria-selected')).toBe('true');
    expect(agentTab()).toBeTruthy();
    expect(agentTab()!.getAttribute('aria-selected')).not.toBe('true');
    expect(el.querySelector('[data-testid="stub-org-tests"]')!.getAttribute('data-visible')).toBe('true');
  });

  it('compact trace focus opens Preview', async () => {
    width = 500;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await exec('trace.focus', {}); });
    expect(el.querySelector('[data-testid="stub-preview"]')).toBeTruthy();
  });

  it('applies focus params, target tabs and persists the split ratio', async () => {
    const el = await mount();
    await ready(el);
    expect(rpc.mock.calls.some(c => c[1] === 'studio.explorer')).toBe(true);
    const badge = el.querySelector('[data-testid="sf-explorer-badge"]');
    expect(badge?.getAttribute('aria-label')).toBe('Failing');
    await openReferences(el);
    const apex = [...el.querySelectorAll('.sf-as-explorer button, .sf-as-explorer li')].find(n => n.textContent?.includes('Foo'));
    expect(apex).toBeTruthy();
    await act(async () => { fireEvent.click(apex!); });
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeTruthy();
    // The agent's document bar belongs to the agent tab; the strip keeps the workspace controls.
    expect(el.querySelector('[aria-label="Save Agentforce file"]')).toBeNull();
    const goTo = el.querySelector<HTMLButtonElement>('.sf-etabs-actions [aria-label="Go to file"]');
    expect(goTo).toBeTruthy();
    await act(async () => { fireEvent.click(goTo!); });
    expect(document.querySelector('[role="dialog"], [role="listbox"], [role="option"]')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); });
    const back = el.querySelector<HTMLButtonElement>('.af-backlink');
    expect(back?.textContent).toBe('← QC.agent');
    await act(async () => { fireEvent.click(back!); });
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeNull();
    expect(el.querySelector('[aria-label="Save Agentforce file"]')).toBeTruthy();
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="Browse org agents"]')!); });
    await act(async () => { fireEvent.click(apex!); });
    const scenario = [...el.querySelectorAll('.sf-as-explorer button')].find(n => n.textContent?.includes('a.scenario') || n.textContent?.trim().startsWith('a'));
    if (scenario) await act(async () => { fireEvent.click(scenario); });
  });

  it('opens Lightning Types, folds explorer sections and hides the explorer', async () => {
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (p: string, method: string, args?: any) => {
      if (method === 'studio.explorer') return { ok: true, nodes: [{ kind: 'agent', path: 'force-app/bots/QC.agent', apiName: 'QC' }, { kind: 'lightning-type', apiName: 'c__Order', path: 'lightningTypes/Order', usedBy: ['force-app/bots/Help.agent'] }] };
      if (method === 'studio.lightningType') return { ok: true, data: { ref: args.ref, standard: false, status: 'ready', title: 'Order', properties: [], files: [] } };
      return base(p, method, args);
    });
    const el = await mount();
    await ready(el);
    const explorer = () => el.querySelector('[data-testid="salesforce-agent-script-explorer"]');
    await openReferences(el);
    const typeNode = [...explorer()!.querySelectorAll('button')].find(n => n.textContent?.includes('c__Order'))!;
    await act(async () => { fireEvent.click(typeNode); });
    await flush();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.lightningType', { projectId: 'proj-1', ref: 'c__Order' });
    const view = el.querySelector('[data-testid="lightning-type-view"]')!;
    expect(view.querySelector('h2')!.textContent).toBe('Order');
    await act(async () => { fireEvent.click([...view.querySelectorAll('button')].find(n => n.textContent === 'Help')!); });
    await flush();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/Help.agent' }));
    // Fold and unfold a section.
    const toggle = () => explorer()!.querySelector('[data-testid="sf-explorer-lightning-type"] button[aria-expanded]')!;
    await act(async () => { fireEvent.click(toggle()); });
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    await act(async () => { fireEvent.click(toggle()); });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    // Hide from the header, restore with Cmd+B.
    await act(async () => { fireEvent.click(explorer()!.querySelector('button[aria-label="Hide explorer"], button[title^="Hide explorer"]')!); });
    expect(explorer()).toBeNull();
    await act(async () => { fireEvent.keyDown(el.querySelector('.sf-studio')!, { key: 'b', metaKey: true }); });
    expect(explorer()).toBeTruthy();
    // Compact studios open a type in the code tool.
    await resize(500);
    await act(async () => { fireEvent.keyDown(el.querySelector('.sf-studio')!, { key: 'p', ctrlKey: true }); });
    const pick = [...document.querySelectorAll('[role="option"], li, button')].find(n => n.textContent?.includes('c__Order') && !n.closest('[data-testid="salesforce-agent-script-explorer"]'));
    expect(pick).toBeTruthy();
    await act(async () => { fireEvent.click(pick!); });
    await flush();
    expect(el.querySelector('[data-testid="lightning-type-view"]')).toBeTruthy();
    rpc.mockImplementation(base);
  });

  it('opens a type\'s component and walks back to the type', async () => {
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (p: string, method: string, args?: any) => {
      if (method === 'studio.explorer') return { ok: true, nodes: [
        { kind: 'agent', path: 'force-app/bots/QC.agent', apiName: 'QC', uses: [{ kind: 'lightning-type', apiName: 'c__Order' }, { kind: 'lwc', apiName: 'c/orderCard' }] },
        { kind: 'lightning-type', apiName: 'c__Order', path: 'lightningTypes/Order', usedBy: ['force-app/bots/QC.agent'] },
        { kind: 'lwc', apiName: 'c/orderCard', path: 'lwc/orderCard', usedBy: ['force-app/bots/Help.agent'], via: ['c__Order'] }
      ] };
      if (method === 'studio.lightningType') return { ok: true, data: { ref: args.ref, standard: false, status: 'ready', title: 'Order', properties: [], files: [], components: [{ ref: 'c/orderCard', namespace: 'c', name: 'orderCard', role: 'renderer', channel: 'lightningDesktopGenAi', target: '$', path: 'lwc/orderCard' }, { ref: 'c/ghost', namespace: 'c', name: 'ghost', role: 'editor', channel: 'lightningDesktopGenAi', target: '$' }] } };
      if (method === 'studio.lwc') return { ok: true, data: { ref: args.ref, name: args.ref.split('/')[1], status: 'ready', path: `lwc/${args.ref.split('/')[1]}`, files: [{ path: 'lwc/orderCard/orderCard.html', content: '<template></template>' }] } };
      return base(p, method, args);
    });
    const el = await mount();
    await ready(el);
    await openReferences(el);
    const explorer = () => el.querySelector('[data-testid="salesforce-agent-script-explorer"]')!;
    const lwcNode = [...explorer().querySelectorAll('button')].find(n => n.textContent?.includes('c/orderCard'))!;
    await act(async () => { fireEvent.click(lwcNode); });
    await flush();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.lwc', { projectId: 'proj-1', ref: 'c/orderCard' });
    let view = el.querySelector('[data-testid="lwc-bundle-view"]')!;
    expect(view.querySelector('.sf-lt-source')!.textContent).toBe('<template></template>');
    expect(el.querySelector('.sf-etab.is-active')!.textContent).toContain('LWC');
    await act(async () => { fireEvent.click([...view.querySelectorAll('button')].find(n => n.textContent === 'Help')!); });
    await flush();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/Help.agent' }));
    // From the component to its type, and from the type to a component the explorer does not list.
    await act(async () => { fireEvent.click(lwcNode); });
    await flush();
    view = el.querySelector('[data-testid="lwc-bundle-view"]')!;
    await act(async () => { fireEvent.click([...view.querySelectorAll('button')].find(n => n.textContent === 'c__Order')!); });
    await flush();
    const typeView = el.querySelector('[data-testid="lightning-type-view"]')!;
    await act(async () => { fireEvent.click([...typeView.querySelectorAll('button')].find(n => n.textContent === 'c/ghost')!); });
    await flush();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.lwc', { projectId: 'proj-1', ref: 'c/ghost' });
    expect(el.querySelector('[data-testid="lwc-bundle-view"] h2')!.textContent).toBe('ghost');
    rpc.mockImplementation(base);
  });

  it('lists an unfolded agent the explorer had not scanned', async () => {
    const base = rpc.getMockImplementation()!;
    const help = 'force-app/bots/Help.agent';
    rpc.mockImplementation(async (p: string, method: string, args?: any) => {
      if (method === 'studio.explorer') return { ok: true, nodes: [
        { kind: 'agent', path: 'force-app/bots/QC.agent', apiName: 'QC', uses: [] },
        ...(args?.expand?.includes(help) ? [{ kind: 'agent', path: help, apiName: 'Help', uses: [{ kind: 'apex', apiName: 'Foo' }] }, { kind: 'apex', apiName: 'Foo', path: 'force-app/classes/Foo.cls', usedBy: [help] }] : [])
      ] };
      return base(p, method, args);
    });
    const el = await mount();
    await ready(el);
    const twisty = () => el.querySelector<HTMLButtonElement>('button[aria-label$="what Help uses"]')!;
    await act(async () => { fireEvent.click(twisty()); });
    await flush();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.explorer', { projectId: 'proj-1', expand: [help] });
    expect(el.querySelector('[aria-label="Help references"]')!.textContent).toContain('Foo');
    rpc.mockImplementation(base);
  });

  it('keeps a target tab in front when the panel remounts, and its agent tab restores the file', async () => {
    const first = await mount('force-app/bots/QC.agent');
    await ready(first);
    await openReferences(first);
    const apex = [...first.querySelectorAll('.sf-as-explorer button')].find(n => n.textContent?.includes('Foo'))!;
    await act(async () => { fireEvent.click(apex); });
    await flush();
    nodes.splice(0).forEach(fn => fn());
    rpc.mockClear();
    const el = await mount();
    await ready(el);
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Open files"] [role="tab"][aria-selected="true"]')?.textContent).toContain('Foo');
    const scriptTab = [...el.querySelectorAll('[aria-label="Open files"] [role="tab"]')].find(n => n.textContent?.includes('Script'))!;
    await act(async () => { fireEvent.click(scriptTab); });
    await flush();
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeNull();
  });

  it('opens every implementation view on the last Project / Org choice', async () => {
    const first = await mount('force-app/bots/QC.agent');
    await ready(first);
    await openReferences(first);
    const apex = [...first.querySelectorAll('.sf-as-explorer button')].find(n => n.textContent?.includes('Foo'))!;
    await act(async () => { fireEvent.click(apex); });
    await flush();
    const orgButton = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[aria-label="Implementation source"] button:last-child')!;
    expect(orgButton(first).getAttribute('aria-pressed')).toBe('false');
    await act(async () => { fireEvent.click(orgButton(first)); });
    await flush();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentActions.source', expect.objectContaining({ target: 'apex://Foo', origin: 'org', orgAlias: 'dev' }));
    nodes.splice(0).forEach(fn => fn());
    rpc.mockClear();
    const el = await mount();
    await ready(el);
    await flush();
    expect(orgButton(el).getAttribute('aria-pressed')).toBe('true');
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentActions.source', expect.objectContaining({ target: 'apex://Foo', origin: 'org' }));
  });

  it('closes editor tabs from the tab context menu', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await openReferences(el);
    const apex = [...el.querySelectorAll('.sf-as-explorer button')].find(n => n.textContent?.includes('Foo'))!;
    await act(async () => { fireEvent.click(apex); });
    const tabs = () => [...el.querySelectorAll('[aria-label="Open files"] [role="tab"]')].map(n => n.textContent);
    expect(tabs()).toHaveLength(2);
    await act(async () => { fireEvent.contextMenu([...el.querySelectorAll('[aria-label="Open files"] [role="tab"]')].find(n => n.textContent?.includes('Foo'))!); });
    await act(async () => { fireEvent.click([...el.querySelectorAll('[role="menuitem"]')].find(n => n.textContent === 'Close others')!); });
    expect(tabs()).toEqual([expect.stringContaining('Script'), expect.stringContaining('Foo')]);
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeTruthy();
  });

  it('reloads comments when the active file is opened again', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    // The open agent is the explorer's scan focus, so it has references however many agents the project lists.
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.explorer', expect.objectContaining({ focus: 'force-app/bots/QC.agent' }));
    const comment = { id: 'c1', path: 'force-app/bots/QC.agent', line: 2, endLine: 2, quote: 'a', body: 'why?', author: { kind: 'user', name: 'You' }, createdAt: 1 };
    rpc.mockImplementation(async (_p: string, method: string, args?: any) => {
      if (method === 'studio.comments.list') return { ok: true, comments: [comment] };
      if (method === 'agentFiles.read') return { ok: true, file: { path: args?.path, content: SOURCE, sha256: SHA } };
      return { ok: true };
    });
    const entry = [...el.querySelectorAll<HTMLElement>('[data-testid="salesforce-agent-script-explorer"] button')].find(n => n.textContent?.includes('QC'))!;
    await act(async () => { fireEvent.click(entry); });
    await flush();
    const last = sent(el).filter((m: any) => m.type === 'setComments').at(-1);
    expect(last?.comments).toEqual([comment]);
    expect(el.querySelector('.sf-explorer-col [data-testid="salesforce-agent-script-explorer"]')).toBeTruthy();
  });

  it('opens focused files and lines from panel params', async () => {
    const el = await mount();
    el.remove();
    const el2 = await mount({ params: { path: 'force-app/bots/QC.agent', line: '3', readOnly: '1' } });
    await ready(el2);
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/QC.agent' }));
    expect(sent(el2).some((m: any) => m.type === 'revealLine' && m.line === 3)).toBe(true);
  });
});

describe('AgentScriptPanel follows the driving thread', () => {
  const from = { threadId: 'thr-9', title: 'Fix QC' };
  const run = (command: string, input: Record<string, unknown>, source?: typeof from) =>
    control.options.execute({ id: `c-${command}`, command, input, ...(source ? { from: source } : {}) });
  const reveals = (el: HTMLElement, line: number) => sent(el).filter((m: any) => m.type === 'revealLine' && m.line === line).length;
  const chip = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-testid="salesforce-follow-chip"]');
  const toast = (el: HTMLElement) => el.querySelector('[data-testid="salesforce-follow-toast"]');
  const button = (root: Element, name: string) => [...root.querySelectorAll('button')].find(b => b.textContent === name)!;

  it('holds a reveal as a toast while the user types, then shows it on request', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    expect(chip(el)).toBeNull();
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    // A command from a thread names who the Studio follows; reveals apply while nobody types.
    await act(async () => { expect(await run('editor.reveal', { line: 3 }, from)).toMatchObject({ revealedLine: 3 }); });
    expect(reveals(el, 3)).toBe(1);
    expect(chip(el)!.textContent).toContain('Following Fix QC');
    expect(chip(el)!.getAttribute('aria-label')).toBe('Following Fix QC: Pause');
    expect(chip(el)!.getAttribute('aria-pressed')).toBe('true');
    // An edit from the reveal itself is not typing.
    await post(el, { type: 'dirty', dirty: true });
    await act(async () => { expect(await run('editor.reveal', { line: 1 }, from)).toMatchObject({ revealedLine: 1 }); });
    clock.mockReturnValue(start + 5000);
    await post(el, { type: 'dirty', dirty: true });
    let result: unknown;
    await act(async () => { result = await run('editor.reveal', { line: 2 }, from); });
    expect(result).toEqual({ held: 'typing' });
    expect(reveals(el, 2)).toBe(0);
    expect(toast(el)!.textContent).toBe('Fix QC wants to go to line 2. Held while you were typing.ShowDismiss');
    expect(control.options.state()).toMatchObject({ follow: 'on', heldReveal: 'editor.reveal' });
    // A file switch over the unsaved draft is refused now rather than held behind the typing.
    await act(async () => { await expect(run('file.open', { path: 'force-app/bots/Other.agent' }, from)).rejects.toThrow('Save the current draft before switching files.'); });
    expect(toast(el)!.textContent).toContain('go to line 2');
    // Proposals and preview never wait: they do not move the cursor.
    await act(async () => { await run('layout.set', { compact: true }, from); });
    expect(sent(el).filter((m: any) => m.type === 'setLayout').pop()).toMatchObject({ compact: true });
    await act(async () => { fireEvent.click(button(toast(el)!, 'Show')); });
    await flush();
    expect(reveals(el, 2)).toBe(1);
    expect(toast(el)).toBeNull();
    expect(control.options.state().heldReveal).toBeUndefined();
  });

  it('pauses following: reveals wait until shown or dismissed, and resume restores them', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await run('graph.focus', { node: 'topic.main' }, { threadId: 'thr-2' }); });
    expect(el.querySelector('[data-testid="stub-graph"]')!.getAttribute('data-focus')).toBe('topic.main:1');
    // An untitled thread still shows the chip.
    expect(chip(el)!.textContent).toContain('Following The agent');
    await act(async () => { fireEvent.click(chip(el)!); });
    expect(chip(el)!.getAttribute('aria-pressed')).toBe('false');
    expect(chip(el)!.textContent).toContain('Following paused');
    expect(chip(el)!.getAttribute('aria-label')).toBe('Following paused: Resume');
    expect(control.options.state().follow).toBe('paused');
    let result: unknown;
    await act(async () => { result = await run('graph.focus', { node: 'topic.billing' }); });
    expect(result).toEqual({ held: 'paused' });
    expect(toast(el)!.textContent).toContain('The agent wants to show topic.billing in the graph. Held while following is paused.');
    await act(async () => { fireEvent.click(button(toast(el)!, 'Dismiss')); });
    expect(toast(el)).toBeNull();
    expect(el.querySelector('[data-testid="stub-graph"]')!.getAttribute('data-focus')).toBe('topic.main:1');
    // A held reveal that fails when shown reports why.
    await act(async () => { await run('file.open', { path: 'force-app/bots/Missing.agent' }); });
    await post(el, { type: 'dirty', dirty: true });
    await act(async () => { fireEvent.click(button(toast(el)!, 'Show')); });
    await flush();
    expect(toast(el)).toBeNull();
    expect(el.textContent).toContain('Save the current draft before switching files.');
    await post(el, { type: 'dirty', dirty: false });
    await act(async () => { fireEvent.click(chip(el)!); });
    expect(control.options.state().follow).toBe('on');
    // Well after the last edit, so a slow run cannot read it as typing.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    await act(async () => { expect(await run('editor.reveal', { line: 2 })).toMatchObject({ revealedLine: 2 }); });
  });

  it.each([1000, 500])('opens Preview from the document toolbar at width %i without restarting it', async (w) => {
    width = w;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const button = el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agent-script-preview"]')!;
    expect(button.disabled).toBe(false);
    await act(async () => { fireEvent.click(button); });
    const preview = el.querySelector('[data-testid="stub-preview"]')!;
    expect(preview).toBeTruthy();
    expect(preview.getAttribute('data-command')).toBe('');
    await act(async () => { fireEvent.click(el.querySelector('[data-testid="stub-run"]')!); });
    await act(async () => { await exec('panel.hide'); });
    await act(async () => { fireEvent.click(button); });
    expect(el.querySelector('[data-testid="stub-preview"]')).toBe(preview);
    expect(preview.getAttribute('data-command')).toBe('');
    expect((el.querySelector('[data-testid="studio-view-preview"]') as HTMLElement).style.display).not.toBe('none');
    expect(control.options.state().tabs).toContain('view:preview');
  });

  it('has no Publish or Release entry point in the Studio', async () => {
    rpc.mockImplementation(baseRpc);
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="More save options"]')!); });
    expect(el.querySelector('[data-testid="salesforce-agent-script-publish"]')).toBeNull();
    await act(async () => { await exec('panel.open', { tool: 'agents' }); });
    await flush();
    await expect(exec('panel.open', { tool: 'release' })).rejects.toThrow();
    expect(el.querySelector('[data-testid="studio-release-pane"]')).toBeNull();
    expect(rpc.mock.calls.some(c => c[1] === 'release.state')).toBe(false);
  });
});
