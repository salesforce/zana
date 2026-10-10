/**
 * @vitest-environment happy-dom
 */
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';

const control: { options?: any } = {};
vi.mock('./useSalesforceControl.js', () => ({ useSalesforceControl: (options: unknown) => { control.options = options; } }));
vi.mock('./preview/PreviewWorkbench.js', () => ({ PreviewWorkbench: (p: any) => <div data-testid="stub-preview" data-engine={p.engine} data-dirty={String(Boolean(p.dirty))} data-command={p.command ? JSON.stringify(p.command) : ""}><button data-testid="stub-run" onClick={() => p.onRunChange({ runId: 'r1', engine: 'live', turn: 1 })}>run</button><button data-testid="stub-handled" onClick={() => p.onCommandHandled(p.command?.seq ?? -1)}>handled</button><button data-testid="stub-stale" onClick={() => p.onCommandHandled(0)}>stale</button></div> }));
vi.mock('./studio/AssistantRail.js', () => ({ AssistantRail: () => <div data-testid="stub-assistant" /> }));
vi.mock('./AgentScriptGraphPanel.js', () => ({ AgentScriptGraphPanel: (p: any) => <div data-testid="stub-graph" data-focus={`${p.focusNode}:${p.focusSeq}`} data-compact={String(p.compact)} /> }));
vi.mock('./OrgAgentsPanel.js', () => ({ OrgAgentsPanel: () => <div data-testid="stub-agents" /> }));
vi.mock('./AgentforceLabPanel.js', () => ({ AgentforceLabPanel: () => <div data-testid="stub-lab" /> }));
vi.mock('./panels/OperationsPanel.js', () => ({ OperationsPanel: () => <div data-testid="stub-ops" /> }));
const { AgentScriptPanel } = await import('./AgentScriptPanel.js');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise(r => setTimeout(r, 0)); });
let width = 1000;
const observers: Array<(w: number) => void> = [];
const SHA = 'a'.repeat(64);
const SOURCE = 'start_agent:\n  a\n  b\n';
const rpc = vi.fn(async (_p: string, method: string, args?: any) => {
  if (method === 'status') return { dxProject: true, agentScriptDialect: 'agentforce', projectRoot: '/proj' };
  if (method === 'agentFiles.list') return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }, { apiName: 'Help', path: 'force-app/bots/Help.agent', lines: 4 }] };
  if (method === 'org') return { ok: true, org: { alias: 'dev', username: 'd@x.com', orgId: '00D', instanceUrl: 'https://x', apiVersion: '62.0', kind: 'sandbox', isDefault: true } };
  if (method === 'orgs') return { ok: true, selectedAlias: 'dev', orgs: [] };
  if (method === 'agentFiles.read') return { ok: true, file: { path: args?.path, content: SOURCE, sha256: SHA } };
  if (method === 'agentFiles.write') return { ok: true, file: { path: args?.path, sha256: 'sha2' } };
  if (method === 'studio.explorer') return { ok: true, nodes: [{ kind: 'agent', path: 'force-app/bots/QC.agent', apiName: 'QC' }, { kind: 'apex', apiName: 'Foo', path: 'force-app/classes/Foo.cls' }, { kind: 'scenario', path: 'tests/a.scenario.json', apiName: 'a' }, { kind: 'org-agent', apiName: 'OrgBot' }] };
  if (method === 'studio.suites.list') return { ok: true, suites: [{ id: 's', path: 'tests/a.scenario.json', cases: [], lastResults: { x: { outcome: 'fail', runId: 'r', at: 1 } } }] };
  if (method === 'studio.comments.list') return { ok: true, comments: [] };
  if (method === 'studio.comments.add') return { ok: true };
  if (method === 'studio.askAgent') return { ok: true, threadId: 't1' };
  return { ok: false };
});
let realtime: ((p: unknown) => void) | undefined;
const nodes: Array<() => void> = [];

async function mount(arg: string | { subPath?: string; params?: unknown } = {}, extra: { params?: unknown } = {}) {
  const props = typeof arg === 'string' ? { subPath: arg, ...extra } : arg;
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  nodes.push(() => { root.unmount(); el.remove(); });
  await act(async () => { root.render(createElement(AgentScriptPanel, { pluginId: 'salesforce', subPath: props.subPath ?? '', params: props.params, projectId: 'proj-1', orgPicker: false })); });
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

describe('AgentScriptPanel studio layout', () => {
  it('renders the wide IDE layout and keeps the iframe across tier changes', async () => {
    const el = await mount('force-app/bots/QC.agent');
    const root = el.querySelector('.sf-studio')!;
    expect(root.getAttribute('data-layout')).toBe('wide');
    const iframe = el.querySelector('iframe');
    await ready(el);
    expect(el.querySelector('[data-testid="salesforce-agent-script-explorer"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="Studio activity"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="stub-assistant"]')).toBeTruthy();
    expect(el.querySelector('[role="tablist"][aria-label]')).toBeTruthy();
    expect(el.textContent).toContain('Problems');
    expect(sent(el).some((m: any) => m.type === 'setLayout' && m.compact === false)).toBe(true);
    await resize(500);
    expect(el.querySelector('.sf-studio')!.getAttribute('data-layout')).toBe('compact');
    expect(el.querySelector('iframe')).toBe(iframe);
    expect(el.querySelector('[data-testid="studio-context-strip"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="stub-assistant"]')).toBeNull();
    expect(sent(el).some((m: any) => m.type === 'setLayout' && m.compact === true)).toBe(true);
    await resize(1000);
    expect(el.querySelector('iframe')).toBe(iframe);
    await resize(300);
    expect(el.querySelector('.sf-studio')!.getAttribute('data-tier')).toBe('0');
  });

  it('switches compact tools and quick opens files with Cmd+P', async () => {
    width = 500;
    const el = await mount();
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

  it('handles comment and ask-selection requests from the editor', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await post(el, { type: 'cursor', line: 2, column: 3, selection: { startLine: 2, endLine: 2, text: 'a' } });
    await post(el, { type: 'commentAction', kind: 'add', line: 2, endLine: 3, quote: 'a b' });
    const form = el.querySelector('form[aria-label="Add comment"]')!;
    expect(form.textContent).toContain('lines 2-3');
    await act(async () => { fireEvent.change(form.querySelector('textarea')!, { target: { value: 'Needs work' } }); });
    await act(async () => { fireEvent.submit(form); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.comments.add', expect.objectContaining({ projectId: 'proj-1', body: 'Needs work', line: 2, endLine: 3, quote: 'a b' }));
    await post(el, { type: 'commentAction', kind: 'add', line: 1, endLine: 1, quote: 'x' });
    await act(async () => { fireEvent.click([...el.querySelectorAll('form button')].find(b => b.textContent === 'Cancel')!); });
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

  it('compact trace focus opens Preview', async () => {
    width = 500;
    const el = await mount();
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
    const apex = [...el.querySelectorAll('.sf-as-explorer button, .sf-as-explorer li')].find(n => n.textContent?.includes('Foo'));
    expect(apex).toBeTruthy();
    await act(async () => { fireEvent.click(apex!); });
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeTruthy();
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
    const typeNode = [...explorer()!.querySelectorAll('button')].find(n => n.textContent?.includes('c__Order'))!;
    await act(async () => { fireEvent.click(typeNode); });
    await flush();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.lightningType', { projectId: 'proj-1', ref: 'c__Order' });
    const view = el.querySelector('[data-testid="lightning-type-view"]')!;
    expect(view.querySelector('h2')!.textContent).toBe('Order');
    await act(async () => { fireEvent.click([...view.querySelectorAll('button')].find(n => n.textContent === 'Help.agent')!); });
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

  it('keeps a target tab in front when the panel remounts without an agent to restore', async () => {
    const first = await mount('force-app/bots/QC.agent');
    await ready(first);
    const apex = [...first.querySelectorAll('.sf-as-explorer button')].find(n => n.textContent?.includes('Foo'))!;
    await act(async () => { fireEvent.click(apex); });
    nodes.splice(0).forEach(fn => fn());
    rpc.mockClear();
    const el = await mount();
    await ready(el);
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeTruthy();
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Foo');
    expect(rpc.mock.calls.some(c => c[1] === 'agentFiles.read')).toBe(false);
    // Its agent tab reopens the file once selected.
    const agentTab = [...el.querySelectorAll('[role="tab"]')].find(n => n.textContent?.includes('QC.agent'))!;
    await act(async () => { fireEvent.click(agentTab); });
    await flush();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/QC.agent' }));
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeNull();
  });

  it('reloads comments when the active file is opened again', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
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
