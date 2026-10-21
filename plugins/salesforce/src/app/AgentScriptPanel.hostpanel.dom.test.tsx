/**
 * @vitest-environment happy-dom
 */
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';

const control: { options?: any } = {};
vi.mock('./useSalesforceControl.js', () => ({ useSalesforceControl: (options: unknown) => { control.options = options; } }));
vi.mock('./preview/PreviewWorkbench.js', () => ({ PreviewWorkbench: (p: any) => <div data-testid="stub-preview" data-engine={p.engine} data-dirty={String(Boolean(p.dirty))} data-command={p.command ? JSON.stringify(p.command) : ""}><button data-testid="stub-run" onClick={() => p.onRunChange({ runId: 'r1', engine: 'live', turn: 1 })}>run</button><button data-testid="stub-handled" onClick={() => p.onCommandHandled(p.command?.seq ?? -1)}>handled</button><button data-testid="stub-stale" onClick={() => p.onCommandHandled(0)}>stale</button></div> }));
vi.mock('./studio/AskAgentButton.js', () => ({ AskAgentButton: () => <div data-testid="stub-ask-agent" /> }));
vi.mock('./AgentScriptGraphPanel.js', () => ({ AgentScriptGraphPanel: (p: any) => <div data-testid="stub-graph" data-focus={`${p.focusNode}:${p.focusSeq}`} data-compact={String(p.compact)} /> }));
vi.mock('./OrgAgentsPanel.js', () => ({ OrgAgentsPanel: (p: any) => <div data-testid="stub-agents"><button data-testid="stub-agents-publish" onClick={() => p.onPublish?.('force-app/bots/Help.agent')}>publish</button></div> }));
vi.mock('./AgentforceLabPanel.js', () => ({ AgentforceLabPanel: () => <div data-testid="stub-lab" /> }));
vi.mock('./panels/OperationsPanel.js', () => ({ OperationsPanel: () => <div data-testid="stub-ops" /> }));
const { AgentScriptPanel } = await import('./AgentScriptPanel.js');
const { StudioPanelTool } = await import('./studio/StudioPanelTool.js');
const { resetStudioToolBridge } = await import('./studio/studio-tool-bridge.js');
const { readStudioLayout } = await import('./studio/studio-layout.js');

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
let sidePanel = true;
let sidePanelOpen: boolean | undefined;
const navigate: { toCompose: ReturnType<typeof vi.fn>; openPanelTool: ReturnType<typeof vi.fn>; openPanelAgent?: ReturnType<typeof vi.fn> } = { toCompose: vi.fn(), openPanelTool: vi.fn(() => true) };

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
  localStorage.clear(); rpc.mockClear(); observers.length = 0; width = 1000; realtime = undefined; sidePanel = true; sidePanelOpen = undefined; resetStudioToolBridge();
  navigate.openPanelTool = vi.fn(() => true); delete navigate.openPanelAgent;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  (globalThis as any).ResizeObserver = class { constructor(cb: any) { observers.push(w => cb([{ contentRect: { width: w } }])); } observe() {} disconnect() {} };
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
    const self = this as any;
    return self.__win ??= Object.assign(Object.create(window), { postMessage: vi.fn() });
  });
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc, useZccNavigate: () => ({ toCompose: vi.fn() }), getSettings: async () => ({ values: { agentScriptDialect: 'agentforce' } }), setSettings: async () => undefined };
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = {
    useZccNavigate: () => navigate,
    useZccContext: () => ({ projectId: 'proj-1', threadId: null, sidePanel, ...(sidePanelOpen === undefined ? {} : { sidePanelOpen }) }),
    useSettings: () => ({ values: { agentScriptDialect: 'agentforce', defaultOrg: 'dev' }, isLoading: false }),
    useRealtime: (_c: string, h: (p: unknown) => void) => { realtime = h; }
  };
});
afterEach(() => { nodes.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; });

/** Plays the host side panel: mounts the tab for `tool` the way PluginPanelHostLayout would. */
async function hostTab(tool: 'preview' | 'graph' | 'test', projectId = 'proj-1', tabId?: string) {
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  const unmount = () => { root.unmount(); el.remove(); };
  nodes.push(unmount);
  await act(async () => { root.render(<StudioPanelTool tool={tool} title={tool} projectId={projectId} tabId={tabId} />); });
  await flush();
  return { el, unmount: () => act(async () => unmount()) };
}

describe('AgentScriptPanel beside the host side panel', () => {
  it('opens tools in the host panel and renders them there, keeping their state across tab switches', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    expect(el.querySelector('.af-tools')).toBeNull();
    expect(el.querySelector('[data-testid="stub-ask-agent"]')).toBeTruthy();
    // With nothing shown yet, "Show side panel" opens Preview in the host panel.
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="Show side panel"]')!); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-preview' });
    navigate.openPanelTool.mockClear();
    await act(async () => { fireEvent.click(el.querySelector('[data-testid="salesforce-agent-script-preview"]')!); });
    expect(navigate.openPanelTool).toHaveBeenCalledWith({ actionId: 'studio-preview' });
    const tab = await hostTab('preview');
    const preview = tab.el.querySelector('[data-testid="stub-preview"]')!;
    expect(preview).toBeTruthy();
    expect(el.querySelector('[data-testid="stub-preview"]')).toBeNull();
    expect(control.options.state()).toMatchObject({ tool: 'preview', panels: { host: true, tabs: ['preview'], kept: [], active: 'preview', open: true } });
    // Commands reach the tool in the host panel.
    await act(async () => { await exec('preview.send', { text: 'hi', engine: 'live' }); });
    await flush();
    expect(JSON.parse(tab.el.querySelector('[data-testid="stub-preview"]')!.getAttribute('data-command')!)).toMatchObject({ type: 'send', text: 'hi' });
    await tab.unmount();
    // A tab switched away or closed is not reported as shown; Studio keeps the tool running.
    expect(control.options.state()).toMatchObject({ tool: 'code', panels: { host: true, tabs: [], kept: ['preview'], active: null, open: false } });
    const again = await hostTab('preview');
    expect(again.el.querySelector('[data-testid="stub-preview"]')).toBe(preview);
    expect(el.querySelector('[aria-label="Show side panel"]')).toBeNull();
    await again.unmount();
  });

  it('hides "Show side panel" while the host panel is open on another tab, and shows it once the panel hides', async () => {
    sidePanelOpen = true;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    // No Studio tool is shown (a thread tab is), yet the panel is open: no toggle.
    expect(el.querySelector('[aria-label="Show side panel"]')).toBeNull();
    await act(async () => { nodes.splice(0).forEach(fn => fn()); });
    sidePanelOpen = false;
    const closed = await mount('force-app/bots/QC.agent');
    await ready(closed);
    await act(async () => { fireEvent.click(closed.querySelector('[aria-label="Show side panel"]')!); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-preview' });
  });

  it('reopens the tool last shown in the host panel', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const graph = await hostTab('graph');
    expect(el.querySelector('[aria-label="Show side panel"]')).toBeNull();
    await graph.unmount();
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="Show side panel"]')!); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-graph' });
  });

  it('reports a tool the host agreed to show before its tab attaches', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const preview = await hostTab('preview');
    await act(async () => { await exec('panel.open', { tool: 'graph' }); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-graph' });
    expect(control.options.state()).toMatchObject({ panels: { host: true, active: 'graph', open: true } });
    // Once the host switches tabs, the attached tool is the one reported.
    await preview.unmount();
    const graph = await hostTab('graph');
    expect(control.options.state()).toMatchObject({ panels: { active: 'graph', open: true } });
    await graph.unmount();
    expect(control.options.state()).toMatchObject({ panels: { active: null, open: false } });
  });

  it('browses org agents in an editor tab, not the host panel', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await exec('panel.open', { tool: 'agents' }); });
    await flush();
    expect(navigate.openPanelTool).not.toHaveBeenCalled();
    const tab = [...el.querySelectorAll('.sf-etab')].find(row => row.textContent?.includes('Org agents'))!;
    expect(tab.getAttribute('data-kind')).toBe('org');
    expect(tab.querySelector('.sf-etab-kind')!.textContent).toBe('ORG');
    expect(tab.querySelector('.sf-etab-ro')).toBeNull();
    const view = el.querySelector<HTMLElement>('[data-testid="studio-org-agents-view"]')!;
    expect(view.querySelector('[data-testid="stub-agents"]')).toBeTruthy();
    expect(view.style.display).toBe('');
    expect(el.querySelector('[data-testid="studio-target-view"]')).toBeNull();
    // Publishing from the list lands on that agent's editor tab; the list stays mounted behind it.
    const panel = view.querySelector('[data-testid="stub-agents"]');
    await act(async () => { fireEvent.click(el.querySelector('[data-testid="stub-agents-publish"]')!); });
    await flush();
    expect(view.style.display).toBe('none');
    expect(view.querySelector('[data-testid="stub-agents"]')).toBe(panel);
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-release' });
    // The tab is kept with the layout.
    const layoutKey = Object.keys(localStorage).find(key => key.startsWith('salesforce:studio:') && !key.includes(':split:'))!;
    expect(readStudioLayout(layoutKey).tabs).toEqual(expect.arrayContaining([{ id: 'org-agents', kind: 'org', label: 'Org agents', target: 'agents' }]));
    // Closing the tab unmounts the list.
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="Close Org agents"]')!); });
    expect(el.querySelector('[data-testid="studio-org-agents-view"]')).toBeNull();
  });

  it('shows host tools on panel.show and leaves closing them to the host panel', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await exec('panel.show'); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-preview' });
    await expect(exec('panel.hide')).rejects.toThrow('ZCC side panel');
    await expect(exec('panel.close', { tool: 'graph' })).rejects.toThrow('ZCC side panel');
  });

  it('starts a tool fresh in a reopened tab and keeps it within the same tab', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const first = await hostTab('preview', 'proj-1', 'tab-1');
    const preview = first.el.querySelector('[data-testid="stub-preview"]');
    await first.unmount();
    const same = await hostTab('preview', 'proj-1', 'tab-1');
    expect(same.el.querySelector('[data-testid="stub-preview"]')).toBe(preview);
    await same.unmount();
    const reopened = await hostTab('preview', 'proj-1', 'tab-2');
    const fresh = reopened.el.querySelector('[data-testid="stub-preview"]');
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(preview);
  });

  it('shows the tool beside the right project only', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const other = await hostTab('graph', 'proj-2');
    expect(other.el.querySelector('[data-testid="stub-graph"]')).toBeNull();
    expect(other.el.textContent).toContain('needs Agent Script Studio');
    const own = await hostTab('graph');
    expect(own.el.querySelector('[data-testid="stub-graph"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="stub-graph"]')).toBeNull();
  });

  it('turns the compact strip into a launcher instead of swapping the editor', async () => {
    width = 500;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const strip = el.querySelector('[aria-label="Studio tools"]')!;
    const tab = (name: RegExp) => [...strip.querySelectorAll('[role="tab"]')].find(t => name.test(t.getAttribute('aria-label') ?? t.textContent ?? ''))!;
    await act(async () => { fireEvent.click(tab(/graph/i)); });
    expect(navigate.openPanelTool).toHaveBeenCalledWith({ actionId: 'studio-graph' });
    expect(el.querySelector('.af-workspace')!.getAttribute('data-mode')).toBe('editor');
    await act(async () => { fireEvent.click(tab(/code/i)); });
    expect(navigate.openPanelTool).toHaveBeenCalledTimes(1);
  });

  it('keeps feeding the host panel while a narrow window\'s panel covers Studio', async () => {
    width = 0;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const tab = await hostTab('graph');
    expect(tab.el.querySelector('[data-testid="stub-graph"]')).toBeTruthy();
    expect(tab.el.textContent).not.toContain('needs Agent Script Studio');
    expect(el.querySelector('.af-tools')).toBeNull();
    await tab.unmount();
  });

  it('keeps its own panel when the host does not take the tool', async () => {
    navigate.openPanelTool = vi.fn(() => false);
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { fireEvent.click(el.querySelector('[data-testid="salesforce-agent-script-preview"]')!); });
    await flush();
    expect(navigate.openPanelTool).toHaveBeenCalled();
    expect(el.querySelector('[data-testid="stub-preview"]')).toBeTruthy();
  });

  it('goes back to the host panel once the host takes a later tool', async () => {
    navigate.openPanelTool = vi.fn(() => false);
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await exec('panel.open', { tool: 'preview' }); });
    await flush();
    expect(el.querySelector('.af-tools')).toBeTruthy();
    expect(control.options.state().panels).not.toHaveProperty('host');
    // The host is ready now (its listener subscribed late): the next open asks it again.
    navigate.openPanelTool.mockReturnValue(true);
    await act(async () => { await exec('panel.open', { tool: 'graph' }); });
    await flush();
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-graph' });
    expect(el.querySelector('.af-tools')).toBeNull();
    const graph = await hostTab('graph');
    expect(graph.el.querySelector('[data-testid="stub-graph"]')).toBeTruthy();
    expect(control.options.state()).toMatchObject({ panels: { host: true, tabs: ['graph'], active: 'graph' } });
    await graph.unmount();
  });

  it('keeps its own panel without a host side panel', async () => {
    sidePanel = false;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    expect(el.querySelector('.af-tools')).toBeTruthy();
    await act(async () => { fireEvent.click(el.querySelector('[data-testid="salesforce-agent-script-preview"]')!); });
    await flush();
    expect(navigate.openPanelTool).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="stub-preview"]')).toBeTruthy();
  });

  it('hands editor agent requests to the side-panel composer, else starts the thread', async () => {
    navigate.openPanelAgent = vi.fn(() => true);
    rpc.mockImplementation(async (p: string, method: string, args?: any) => method === 'studio.draftAgent' ? { ok: true, prompt: 'BRIEF', title: 'Explain selection · QC.agent' } : baseRpc(p, method, args));
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await post(el, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 'a' });
    expect(navigate.openPanelAgent).toHaveBeenCalledWith({ draft: { prompt: 'BRIEF', view: 'force-app/bots/QC.agent', projectId: 'proj-1' }, title: 'Explain selection · QC.agent' });
    expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent')).toBe(false);
    navigate.openPanelAgent = vi.fn(() => false);
    await post(el, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 'a' });
    expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent')).toBe(true);
    rpc.mockImplementation(async (p: string, method: string, args?: any) => method === 'studio.draftAgent' ? { ok: false, error: 'No file' } : baseRpc(p, method, args));
    navigate.openPanelAgent = vi.fn(() => true);
    await post(el, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 'a' });
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('No file');
    rpc.mockImplementation(async (p: string, method: string, args?: any) => method === 'studio.draftAgent' ? { ok: false } : baseRpc(p, method, args));
    await post(el, { type: 'askSelection', action: 'explain-selection', startLine: 1, endLine: 2, text: 'a' });
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('Could not prepare the request.');
  });
});
