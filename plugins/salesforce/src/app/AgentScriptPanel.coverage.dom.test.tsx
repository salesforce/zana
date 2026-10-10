/**
 * @vitest-environment happy-dom
 */
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';
import { queueAgentScriptOpen } from './agent-script-open.js';
import { rememberAgentSelection } from './agent-script-drafts.js';

const control: { options?: any } = {};
vi.mock('./useSalesforceControl.js', () => ({ useSalesforceControl: (options: unknown) => { control.options = options; } }));
vi.mock('./preview/PreviewWorkbench.js', () => ({
  PreviewWorkbench: (p: any) => <div data-testid="stub-preview">
    <button data-testid="reveal-same" onClick={() => p.onRevealSource('force-app/bots/QC.agent', 3)}>same</button>
    <button data-testid="reveal-other" onClick={() => p.onRevealSource('force-app/bots/Help.agent', 4)}>other</button>
  </div>
}));
vi.mock('./studio/AssistantRail.js', () => ({ AssistantRail: () => <div data-testid="stub-assistant" /> }));
vi.mock('./AgentScriptGraphPanel.js', () => ({
  AgentScriptGraphPanel: (p: any) => <div data-testid="stub-graph"><button data-testid="graph-open" onClick={() => { p.onOpenAction('act1'); p.onOpenAction('missing'); }}>open</button></div>
}));
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
const COMMENT = { id: 'c1', path: 'force-app/bots/QC.agent', line: 2, endLine: 2, quote: 'a', body: 'why?', author: { kind: 'user', name: 'You' }, createdAt: 1 };
const overrides: Record<string, (args?: any) => unknown> = {};
const rpc = vi.fn(async (_p: string, method: string, args?: any) => {
  if (overrides[method]) return overrides[method](args);
  if (method === 'status') return { dxProject: true, agentScriptDialect: 'agentforce', projectRoot: '/proj' };
  if (method === 'agentFiles.list') return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }, { apiName: 'Help', path: 'force-app/bots/Help.agent', lines: 4 }] };
  if (method === 'org') return { ok: true, org: { alias: 'dev', username: 'd@x.com', orgId: '00D', instanceUrl: 'https://x', apiVersion: '62.0', kind: 'sandbox', isDefault: true } };
  if (method === 'orgs') return { ok: true, selectedAlias: 'dev', orgs: [] };
  if (method === 'agentFiles.read') return { ok: true, file: { path: args?.path, content: SOURCE, sha256: SHA } };
  if (method === 'agentFiles.write') return { ok: true, file: { path: args?.path, sha256: 'sha2' } };
  if (method === 'studio.explorer') return { ok: true, nodes: [
    { kind: 'agent', path: 'force-app/bots/QC.agent', apiName: 'QC' },
    { kind: 'apex', apiName: 'Foo', path: 'force-app/classes/Foo.cls' },
    { kind: 'flow', apiName: 'Bar' },
    { kind: 'scenario', path: 'tests/a.scenario.json', apiName: 'Scn' },
    { kind: 'org-agent', apiName: 'OrgBot' }] };
  if (method === 'studio.suites.list') return { ok: true, suites: [] };
  if (method === 'studio.comments.list') return { ok: true, comments: [COMMENT] };
  if (method === 'studio.comments.add') return { ok: true };
  if (method === 'studio.comments.resolve') return { ok: true };
  if (method === 'studio.askAgent') return { ok: true, threadId: 't1' };
  return { ok: false };
});
let realtime: ((p: unknown) => void) | undefined;
const nodes: Array<() => void> = [];

async function mount(arg: string | { subPath?: string; params?: unknown; projectId?: string | null } = {}) {
  const props = typeof arg === 'string' ? { subPath: arg } : arg;
  const el = document.createElement('div'); document.body.appendChild(el);
  const root: Root = createRoot(el);
  nodes.push(() => { root.unmount(); el.remove(); });
  const projectId = props.projectId === null ? undefined : props.projectId ?? 'proj-1';
  const render = (params?: unknown) => act(async () => { root.render(createElement(AgentScriptPanel, { pluginId: 'salesforce', subPath: props.subPath ?? '', params, projectId, orgPicker: false })); });
  await render(props.params);
  await flush();
  return Object.assign(el, { rerender: async (params: unknown) => { await render(params); await flush(); } });
}
const post = async (el: HTMLElement, data: Record<string, unknown>) => {
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: el.querySelector('iframe')!.contentWindow, data: { source: PLAYGROUND_BRIDGE_SOURCE, ...data } })); });
  await flush();
};
const ready = (el: HTMLElement) => post(el, { type: 'ready' });
const resize = async (w: number) => { width = w; await act(async () => { observers.forEach(cb => cb(w)); }); };
const exec = (command: string, input: Record<string, unknown> = {}) => control.options.execute({ id: 'c1', command, input });
const click = async (node: Element | null | undefined) => { expect(node).toBeTruthy(); await act(async () => { fireEvent.click(node!); }); await flush(); };
const byText = (root: ParentNode, selector: string, text: RegExp) => [...root.querySelectorAll(selector)].find(n => text.test(n.textContent ?? ''));
const sent = (el: HTMLElement) => (el.querySelector('iframe')!.contentWindow!.postMessage as any).mock.calls.map((c: any[]) => c[0]);
const banner = (el: HTMLElement) => el.querySelector('.sf-as-banner.is-error')?.textContent;
const SNAPSHOT = { type: 'snapshot', content: SOURCE, issues: 1,
  actions: [{ id: 'act1', name: 'Act One', owner: 'topic', target: 'apex://Foo', description: '', line: 2, inputs: [], outputs: [], uses: [] }],
  diagnostics: [{ severity: 'error', message: 'bad token', line: 2, column: 1, endLine: 2, endColumn: 4 }] };

beforeEach(() => {
  localStorage.clear(); rpc.mockClear(); observers.length = 0; width = 1000; realtime = undefined;
  for (const key of Object.keys(overrides)) delete overrides[key];
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

describe('AgentScriptPanel wide activity bar, explorer and quick open', () => {
  it('toggles the explorer, opens agents and quick-opens from the activity bar', async () => {
    const el = await mount();
    await ready(el);
    const activity = el.querySelector('[aria-label="Studio activity"]')!;
    const explorer = () => el.querySelector('[data-testid="salesforce-agent-script-explorer"]');
    expect(explorer()).toBeTruthy();
    await click(byText(activity, 'button', /files/i) ?? activity.querySelectorAll('button')[0]);
    expect(explorer()).toBeNull();
    await click(activity.querySelectorAll('button')[0]);
    expect(explorer()).toBeTruthy();
    await click(activity.querySelectorAll('button')[1]);
    expect(el.querySelector('[data-testid="stub-agents"]')).toBeTruthy();
    await click(activity.querySelectorAll('button')[2]);
    expect(document.querySelector('[role="dialog"], [role="listbox"], [role="option"]')).toBeTruthy();
  });

  it('opens explorer nodes: agent, apex, flow, scenario and org agent', async () => {
    const el = await mount();
    await ready(el);
    const explorer = el.querySelector('[data-testid="salesforce-agent-script-explorer"]')!;
    const node = (name: RegExp) => byText(explorer, 'button', name);
    await click(node(/Foo/));
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeTruthy();
    await click(node(/Bar/));
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeTruthy();
    await click(node(/Scn/));
    expect(el.querySelector('[data-testid="stub-lab"]')).toBeTruthy();
    el.querySelector<HTMLElement>('[data-testid="stub-agents"]')?.remove();
    await click(node(/OrgBot/));
    expect(el.querySelector('[data-testid="stub-agents"]')).toBeTruthy();
    rpc.mockClear();
    await click(node(/QC/));
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/QC.agent' }));
  });

  it('quick open picks files, examples and explorer nodes', async () => {
    const el = await mount();
    await ready(el);
    const open = async () => { await act(async () => { fireEvent.keyDown(el.querySelector('.sf-studio')!, { key: 'p', ctrlKey: true }); }); };
    const pick = (re: RegExp) => byText(document, '[role="option"], li, button', re);
    await open();
    rpc.mockClear();
    await click(pick(/Help/));
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/Help.agent' }));
    await open();
    await click(pick(/^Example|Example/));
    await open();
    await click(pick(/Foo/));
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeTruthy();
  });
});

describe('AgentScriptPanel control verbs and compact side panel', () => {
  it('handles preview/graph/trace/proposal verbs in compact mode', async () => {
    width = 500;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await post(el, SNAPSHOT);
    await act(async () => { await exec('preview.start', {}); });
    expect(el.querySelector('[data-testid="stub-preview"]')).toBeTruthy();
    await act(async () => { await exec('preview.send', { text: 'hello' }); });
    await act(async () => { await exec('graph.focus', { node: 'topic.main' }); });
    expect(el.querySelector('[data-testid="stub-graph"]')).toBeTruthy();
    // proposals in compact mode switch back to the editor
    const { settled } = await act(async () => exec('editor.proposeEdit', { path: 'force-app/bots/QC.agent', expectedSha256: SHA, summary: 's', content: 'x' })) as any;
    expect(control.options.state().tool).toBe('code');
    const id = sent(el).find((m: any) => m.type === 'proposeEdit').proposalId;
    await post(el, { type: 'proposalResolved', proposalId: id, outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 1, content: SOURCE, note: 'nope' });
    await expect(settled).resolves.toMatchObject({ outcome: 'rejected', note: 'nope' });
    await act(async () => { await exec('panel.open', { tool: 'comments' }); });
    await act(async () => { await exec('panel.open', { tool: 'files' }); });
    await act(async () => { await exec('panel.close', { tool: 'comments' }); });
    await act(async () => { await exec('panel.hide', {}); });
    await act(async () => { await exec('panel.show', {}); });
    expect(control.options.state().layout).toBeDefined();
  });

  it('opens the files tool in wide and compact layouts, and routes unknown snapshots', async () => {
    const el = await mount();
    await ready(el);
    await act(async () => { await exec('panel.open', { tool: 'files' }); });
    expect(el.querySelector('[data-testid="salesforce-agent-script-explorer"]')).toBeTruthy();
    await post(el, SNAPSHOT);
    await post(el, { type: 'openAction', id: 'act1' });
    await post(el, { type: 'openAction', id: 'nope' });
    expect(el.textContent).toContain('Act One');
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [], diagnostics: [] });
    expect(el.textContent).not.toContain('Act One');
  });

  it('opens graph actions, and trace/preview reveal sources', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await post(el, SNAPSHOT);
    await act(async () => { await exec('graph.focus', { node: 'n' }); });
    await click(el.querySelector('[data-testid="graph-open"]'));
    expect(el.textContent).toContain('Act One');
    await act(async () => { await exec('preview.start', {}); });
    await click(el.querySelector('[data-testid="reveal-same"]'));
    expect(sent(el).some((m: any) => m.type === 'revealLine' && m.line === 3)).toBe(true);
    rpc.mockClear();
    await click(el.querySelector('[data-testid="reveal-other"]'));
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/Help.agent' }));
    expect(sent(el).some((m: any) => m.type === 'revealLine' && m.line === 4)).toBe(true);
  });

  it('shows bottom Output and Tests tabs in wide mode', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const tabs = el.querySelector('[aria-label="Panel"]')!;
    await click(byText(tabs, '[role="tab"]', /output/i));
    expect(el.querySelector('[data-testid="stub-ops"]')).toBeTruthy();
    await click(byText(tabs, '[role="tab"]', /tests/i));
    await click(byText(tabs, '[role="tab"]', /trace/i));
    expect(el.querySelector('[data-testid="studio-trace-pane"]')).toBeTruthy();
  });
});

describe('AgentScriptPanel failure paths', () => {
  it('surfaces askAgent failures from fix-with-agent, selection asks and address-comments', async () => {
    overrides['studio.askAgent'] = () => ({ ok: false, error: 'agent down' });
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await post(el, SNAPSHOT);
    await click(byText(el, 'button', /Fix with agent/));
    expect(banner(el)).toBe('agent down');
    overrides['studio.askAgent'] = () => ({ ok: false });
    await post(el, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 'a' });
    expect(banner(el)).toBe('Could not start the agent.');
    overrides['studio.askAgent'] = () => { throw new Error('boom'); };
    await post(el, { type: 'commentAction', kind: 'open', line: 1, endLine: 1, quote: '' });
    await click(byText(el, 'button', /Address with agent/));
    expect(banner(el)).toBe('boom');
    await post(el, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 'a' });
    expect(banner(el)).toBe('boom');
    overrides['studio.askAgent'] = () => { throw 'plain'; };
    await click(byText(el, 'button', /Fix with agent/));
    expect(banner(el)).toBe('plain');
  });

  it('does not ask the agent without an open file', async () => {
    const el = await mount();
    await ready(el);
    rpc.mockClear();
    await post(el, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 'a' });
    expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent')).toBe(false);
  });

  it('reports failed and rejected comment adds, and ignores blank submissions', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const add = async (body: string) => {
      await post(el, { type: 'commentAction', kind: 'add', line: 2, endLine: 2, quote: 'a' });
      const form = el.querySelector('form[aria-label="Add comment"]')!;
      expect(form.textContent).toContain('line 2');
      await act(async () => { fireEvent.change(form.querySelector('textarea')!, { target: { value: body } }); });
      await act(async () => { fireEvent.submit(form); });
      await flush();
    };
    await add('   ');
    expect(el.querySelector('form[aria-label="Add comment"]')).toBeTruthy();
    expect(rpc.mock.calls.some(c => c[1] === 'studio.comments.add')).toBe(false);
    overrides['studio.comments.add'] = () => ({ ok: false, error: 'locked' });
    await add('real');
    expect(banner(el)).toBe('locked');
    overrides['studio.comments.add'] = () => ({ ok: false });
    await add('real');
    expect(banner(el)).toBe('Could not add the comment.');
    overrides['studio.comments.add'] = () => { throw new Error('offline'); };
    await add('real');
    expect(banner(el)).toBe('offline');
    overrides['studio.comments.add'] = () => { throw 'str'; };
    await add('real');
    expect(banner(el)).toBe('str');
  });

  it('resolves comments and reports resolve failures', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await post(el, { type: 'commentAction', kind: 'open', line: 1, endLine: 1, quote: '' });
    const resolve = async () => {
      await click(byText(el, '.sf-cm-actions button', /^Resolve$/));
      await act(async () => { fireEvent.change(el.querySelector('input[aria-label="Resolution note"]')!, { target: { value: 'fixed' } }); });
      await click(byText(el, '.sf-cm-actions button.is-primary', /Resolve/));
    };
    await resolve();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'studio.comments.resolve', expect.objectContaining({ id: 'c1', note: 'fixed' }));
    overrides['studio.comments.resolve'] = () => { throw new Error('conflict'); };
    await resolve();
    expect(banner(el)).toBe('conflict');
    overrides['studio.comments.resolve'] = () => { throw 'bad'; };
    await resolve();
    expect(banner(el)).toBe('bad');
    await click(el.querySelector('button[aria-label="Jump to line 2"]'));
    expect(sent(el).some((m: any) => m.type === 'revealLine' && m.line === 2)).toBe(true);
  });

  it('surfaces save failures and opens Save As for an unsaved draft', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    overrides['agentFiles.write'] = () => ({ ok: false, error: 'stale file' });
    await post(el, { type: 'persist', path: 'force-app/bots/QC.agent', content: 'x' });
    console.log('DBG', rpc.mock.calls.map(c=>c[1]).join(','), el.querySelector('[role=alert]')?.textContent);
    expect(banner(el)).toBe('stale file');
    overrides['agentFiles.write'] = () => ({ ok: false });
    await post(el, { type: 'persist', path: 'force-app/bots/QC.agent', content: 'x' });
    expect(banner(el)).toBe('Save failed.');
    overrides['agentFiles.write'] = () => { throw new Error('disk'); };
    await post(el, { type: 'persist', path: 'force-app/bots/QC.agent', content: 'x' });
    expect(banner(el)).toBe('disk');
  });

  it('opens Save As when saving an unsaved draft', async () => {
    const draft = await mount();
    await ready(draft);
    await act(async () => { fireEvent.keyDown(draft.querySelector('.sf-studio')!, { key: 's', metaKey: true }); });
    expect(document.body.textContent).toMatch(/Save|path|file name/i);
    expect(document.querySelector('dialog')).toBeTruthy();
  });

  it('refuses to save without a project folder', async () => {
    overrides.status = () => ({ dxProject: false, agentScriptDialect: 'agentforce' });
    const el = await mount({ projectId: null });
    await ready(el);
    await post(el, { type: 'persist', path: 'x.agent', content: 'x' });
    expect(banner(el)).toBe('Open a project folder before saving.');
    await act(async () => { fireEvent.keyDown(el.querySelector('.sf-studio')!, { key: 's', metaKey: true }); });
    expect(el.querySelector('dialog')).toBeNull();
  });
});

describe('AgentScriptPanel startup and focus routing', () => {
  it('opens a queued file on ready', async () => {
    queueAgentScriptOpen('proj-1', 'force-app/bots/Help.agent');
    const el = await mount();
    await ready(el);
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/Help.agent' }));
  });

  it('reopens the remembered file or example selection', async () => {
    rememberAgentSelection('proj-1', 'file:force-app/bots/Help.agent');
    const el = await mount();
    await ready(el);
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/Help.agent' }));
  });

  it('follows later panel params: another file, a line, a dependency and a tool', async () => {
    const el = await mount({ params: { path: 'force-app/bots/QC.agent' } });
    await ready(el);
    await el.rerender({ path: 'force-app/bots/QC.agent', line: '2' });
    expect(sent(el).some((m: any) => m.type === 'revealLine' && m.line === 2)).toBe(true);
    rpc.mockClear();
    await el.rerender({ path: 'force-app/bots/Help.agent', line: '3' });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/bots/Help.agent' }));
    await el.rerender({ apiName: 'Foo', readOnly: 'true' });
    expect(el.textContent).toContain('Foo');
    await el.rerender({ apiName: 'MyFlow' });
    await el.rerender({ tool: 'comments' });
    expect(el.querySelector('[data-testid="studio-comments-pane"]')).toBeTruthy();
    await el.rerender({ nothing: true });
  });

  it('ignores repeated identical cursor reports and keeps the first position', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await post(el, { type: 'cursor', line: 2, column: 3 });
    await post(el, { type: 'cursor', line: 2, column: 3 });
    await post(el, { type: 'cursor', line: 2, column: 4 });
    expect(el.textContent).toMatch(/2/);
  });

  it('applies the realtime comment channel only to its own project', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    rpc.mockClear();
    await act(async () => { realtime?.({ kind: 'comments', projectId: 'other' }); });
    await act(async () => { realtime?.({ kind: 'files' }); });
    await act(async () => { realtime?.(null); });
    expect(rpc.mock.calls.some(c => c[1] === 'studio.comments.list')).toBe(false);
    await act(async () => { realtime?.({ kind: 'comments' }); });
    expect(rpc.mock.calls.some(c => c[1] === 'studio.comments.list')).toBe(true);
  });

  it('shows compact tool switching and resizes back to the wide explorer', async () => {
    width = 500;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const strip = el.querySelector('[aria-label="Studio tools"]')!;
    await click(byText(strip, '[role="tab"]', /preview/i) ?? strip.querySelectorAll('[role="tab"]')[1]);
    await act(async () => { await exec('panel.open', { tool: 'files' }); });
    await resize(1000);
    expect(el.querySelector('.sf-studio')!.getAttribute('data-layout')).toBe('wide');
  });
});
