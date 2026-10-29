/**
 * @vitest-environment happy-dom
 */
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';
import type { PanelTool } from './studio/studio-tool-bridge.js';

const control: { options?: any } = {};
vi.mock('./useSalesforceControl.js', async importOriginal => ({ ...(await importOriginal<object>()), useSalesforceControl: (options: unknown) => { control.options = options; } }));
vi.mock('./preview/PreviewWorkbench.js', () => ({ PreviewWorkbench: (p: any) => {
  const [runs, setRuns] = React.useState(0);
  return <div data-testid="stub-preview" data-runs={runs} data-engine={p.engine} data-dirty={String(Boolean(p.dirty))} data-command={p.command ? JSON.stringify(p.command) : ''}>
    <button data-testid="stub-run" onClick={() => { setRuns(count => count + 1); p.onRunChange({ runId: 'r1', engine: 'live', turn: 1 }); }}>run</button>
    <button data-testid="stub-handled" onClick={() => p.onCommandHandled(p.command?.seq ?? -1)}>handled</button>
    <button data-testid="stub-stale" onClick={() => p.onCommandHandled(0)}>stale</button>
  </div>;
} }));
vi.mock('./studio/AskAgentButton.js', () => ({ AskAgentButton: () => <div data-testid="stub-ask-agent" /> }));
vi.mock('./AgentScriptGraphPanel.js', () => ({ AgentScriptGraphPanel: (p: any) => <div data-testid="stub-graph" data-focus={`${p.focusNode}:${p.focusSeq}`} data-compact={String(p.compact)}><button data-testid="stub-graph-draft" onClick={() => p.onDraftCases(["welcome"])}>draft cases</button><button data-testid="stub-graph-inspect" onClick={() => p.onOpenAction((globalThis as any).__graphInspect)}>inspect</button></div> }));
vi.mock('./studio/OrgTestsView.js', () => ({ OrgTestsView: (p: any) => <button data-testid="stub-org-tests-ask" onClick={() => p.onAskAgent('Explain this org test')}>ask about org test</button> }));
vi.mock('./OrgAgentsPanel.js', () => ({ OrgAgentsPanel: (p: any) => <div data-testid="stub-agents"><button data-testid="stub-agents-open" onClick={() => p.onLocalOpen?.('force-app/bots/Help.agent')}>open</button></div> }));
vi.mock('./AgentforceLabPanel.js', () => ({ AgentforceLabPanel: () => <div data-testid="stub-lab" /> }));
vi.mock('./panels/OperationsPanel.js', () => ({ OperationsPanel: () => <div data-testid="stub-ops" /> }));
const { AgentScriptPanel } = await import('./AgentScriptPanel.js');
const { StudioPanelTool } = await import('./studio/StudioPanelTool.js');
const { resetStudioToolBridge } = await import('./studio/studio-tool-bridge.js');
const { readStudioLayout, scriptTab, scriptTabId, viewTab } = await import('./studio/studio-layout.js');
const { parseAgentScriptSource } = await import('../../lib/agent-script-parse.js');
const { ACTION_AGENT } = await import('../action-fixtures.js');
const { clearStudioRunWorkspaces, updateStudioRun } = await import('./studio/run-workspaces.js');

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
  localStorage.clear(); rpc.mockClear(); rpc.mockImplementation(baseRpc); observers.length = 0; width = 1000; realtime = undefined; sidePanel = true; sidePanelOpen = undefined; resetStudioToolBridge();
  clearStudioRunWorkspaces();
  navigate.toCompose.mockClear();
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
async function hostTab(tool: PanelTool, projectId = 'proj-1', tabId?: string) {
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  let mounted = true;
  const unmount = () => { if (mounted) { mounted = false; root.unmount(); el.remove(); } };
  nodes.push(unmount);
  await act(async () => { root.render(<StudioPanelTool tool={tool} title={tool} projectId={projectId} tabId={tabId} />); });
  await flush();
  return { el, unmount: () => act(async () => unmount()) };
}

const QC = 'force-app/bots/QC.agent';
const HELP = 'force-app/bots/Help.agent';
const LAYOUT_KEY = 'salesforce:studio:proj-1';
const seedWorkspace = (tabs: ReturnType<typeof scriptTab>[], activeTab = scriptTabId(QC)) => {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify({ agents: [{ path: QC, label: 'QC.agent' }], activeAgent: QC,
    workspaces: { [QC]: { tabs, activeTab, bottomOpen: false, bottomTab: 'problems', rail: null } } }));
};

describe('AgentScriptPanel beside the host side panel', () => {
  it('opens tools in the host panel and renders them there, keeping their state across tab switches', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    expect(el.querySelector('.af-tools')).toBeNull();
    expect(el.querySelector('[data-testid="stub-ask-agent"]')).toBeTruthy();
    // The host panel has its own toggle, so Studio shows none; with nothing shown yet, opening the panel shows Preview.
    expect(el.querySelector('[aria-label="Show side panel"]')).toBeNull();
    await act(async () => { await exec('panel.show'); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-actions' });
    navigate.openPanelTool.mockClear();
    // Preview opens beside Script, using the host's existing chrome.
    await act(async () => { fireEvent.click(el.querySelector('[data-testid="salesforce-agent-script-preview"]')!); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-preview' });
    expect(el.querySelector('[data-testid="studio-view-preview"]')).toBeNull();
    expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('flex');
    expect(el.querySelector('.sf-etab[data-kind="view"]')).toBeNull();
    const preview = await hostTab('preview');
    expect(preview.el.querySelector('[data-testid="studio-view-preview"] [data-testid="stub-preview"]')).toBeTruthy();
    await act(async () => { await exec('preview.send', { text: 'hi', engine: 'live' }); });
    await flush();
    expect(JSON.parse(preview.el.querySelector('[data-testid="stub-preview"]')!.getAttribute('data-command')!)).toMatchObject({ type: 'send', text: 'hi' });
    await preview.unmount();
    const tab = await hostTab('actions');
    const list = tab.el.querySelector('.af-actions-list')!;
    expect(list).toBeTruthy();
    expect(el.querySelector('.af-actions-list')).toBeNull();
    expect(control.options.state()).toMatchObject({ tool: 'actions', panels: { host: true, tabs: ['actions'], kept: ['preview'], active: 'actions', open: true } });
    await tab.unmount();
    // A tab switched away or closed is not reported as shown; Studio keeps the tool running.
    expect(control.options.state()).toMatchObject({ panels: { host: true, tabs: [], kept: ['preview', 'actions'], active: null, open: false } });
    const again = await hostTab('actions');
    expect(again.el.querySelector('.af-actions-list')).toBe(list);
    expect(el.querySelector('[aria-label="Show side panel"]')).toBeNull();
    await again.unmount();
  });

  it('leaves the panel toggle to the host, whether its panel is open or hidden', async () => {
    for (const open of [true, false]) {
      sidePanelOpen = open;
      const el = await mount('force-app/bots/QC.agent');
      await ready(el);
      expect(el.querySelector('[aria-label="Show side panel"]')).toBeNull();
      await act(async () => { nodes.splice(0).forEach(fn => fn()); });
    }
  });

  it('reopens the tool last shown in the host panel', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const comments = await hostTab('comments');
    expect(el.querySelector('[aria-label="Show side panel"]')).toBeNull();
    await comments.unmount();
    expect(el.querySelector('[aria-label="Show side panel"]')).toBeNull();
    await act(async () => { await exec('panel.show'); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-comments' });
  });

  it('reports a tool the host agreed to show before its tab attaches', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const actions = await hostTab('actions');
    await act(async () => { await exec('panel.open', { tool: 'comments' }); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-comments' });
    expect(control.options.state()).toMatchObject({ panels: { host: true, active: 'comments', open: true } });
    // Once the host switches tabs, the attached tool is the one reported.
    await actions.unmount();
    const comments = await hostTab('comments');
    expect(control.options.state()).toMatchObject({ panels: { active: 'comments', open: true } });
    await comments.unmount();
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
    expect(navigate.openPanelTool).not.toHaveBeenCalled();
    // The tab is kept with the layout.
    expect(readStudioLayout('salesforce:studio:proj-1').tabs).toEqual(expect.arrayContaining([{ id: 'org-agents', kind: 'org', label: 'Org agents', target: 'agents' }]));
    // Closing the tab unmounts the list.
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="Close Org agents"]')!); });
    expect(el.querySelector('[data-testid="studio-org-agents-view"]')).toBeNull();
  });

  it('shows host tools on panel.show and leaves closing them to the host panel', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await exec('panel.show'); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-actions' });
    await expect(exec('panel.hide')).rejects.toThrow('ZCC side panel');
    await expect(exec('panel.close', { tool: 'actions' })).rejects.toThrow('ZCC side panel');
  });

  it('keeps a tool within the same tab and when a closed host tab is reopened', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const first = await hostTab('actions', 'proj-1', 'tab-1');
    const list = first.el.querySelector('.af-actions-list');
    expect(list).toBeTruthy();
    await first.unmount();
    const same = await hostTab('actions', 'proj-1', 'tab-1');
    expect(same.el.querySelector('.af-actions-list')).toBe(list);
    await same.unmount();
    const reopened = await hostTab('actions', 'proj-1', 'tab-2');
    expect(reopened.el.querySelector('.af-actions-list')).toBe(list);
  });

  it('shows the tool beside the right project only', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const other = await hostTab('actions', 'proj-2');
    expect(other.el.querySelector('.af-actions-list')).toBeNull();
    expect(other.el.textContent).toContain('needs Agent Script Studio');
    const own = await hostTab('actions');
    expect(own.el.querySelector('.af-actions-list')).toBeTruthy();
    expect(el.querySelector('.af-actions-list')).toBeNull();
  });

  it('uses the host tool menu in a compact window while keeping Script visible', async () => {
    width = 500;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    expect(el.querySelector('[aria-label="Studio tools"]')).toBeNull();
    expect(el.querySelector('.sf-atab-view')).toBeNull();
    for (const tool of ['graph', 'preview', 'test'] as const) {
      const panel = await hostTab(tool);
      expect(panel.el.querySelector('[data-agent="force-app/bots/QC.agent"]')).toBeTruthy();
      expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('flex');
      await panel.unmount();
    }
    expect(el.querySelector('.af-workspace')!.getAttribute('data-mode')).toBe('editor');
    expect(el.querySelector('.sf-etab[data-kind="view"]')).toBeNull();
  });

  it('keeps feeding the host panel while a narrow window\'s panel covers Studio', async () => {
    width = 0;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const tab = await hostTab('actions');
    expect(tab.el.querySelector('.af-actions-list')).toBeTruthy();
    expect(tab.el.textContent).not.toContain('needs Agent Script Studio');
    expect(el.querySelector('.af-tools')).toBeNull();
    await tab.unmount();
  });

  it('keeps its own panel when the host does not take the tool', async () => {
    navigate.openPanelTool = vi.fn(() => false);
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await exec('panel.open', { tool: 'actions' }); });
    await flush();
    expect(navigate.openPanelTool).toHaveBeenCalled();
    expect(el.querySelector('.af-actions-list')).toBeTruthy();
  });

  it('goes back to the host panel once the host takes a later tool', async () => {
    navigate.openPanelTool = vi.fn(() => false);
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await exec('panel.open', { tool: 'actions' }); });
    await flush();
    expect(el.querySelector('.af-tools')).toBeTruthy();
    expect(control.options.state().panels).not.toHaveProperty('host');
    // The host is ready now (its listener subscribed late): the next open asks it again.
    navigate.openPanelTool.mockReturnValue(true);
    await act(async () => { await exec('panel.open', { tool: 'comments' }); });
    await flush();
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-comments' });
    expect(el.querySelector('.af-tools')).toBeNull();
    const comments = await hostTab('comments');
    expect(control.options.state()).toMatchObject({ panels: { host: true, tabs: ['comments'], active: 'comments' } });
    await comments.unmount();
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

  it('opens every view beside twelve document tabs without evicting any document', async () => {
    const documents = [scriptTab({ path: QC, label: 'QC.agent' }), ...Array.from({ length: 11 }, (_, index) => ({
      id: `apex:Dependency${index}`, kind: 'apex' as const, label: `Dependency${index}`, target: `Dependency${index}`, path: `force-app/classes/Dependency${index}.cls`
    }))];
    seedWorkspace(documents);
    const el = await mount(QC);
    await ready(el);
    let attached: Awaited<ReturnType<typeof hostTab>> | undefined;
    for (const [tool, target] of [['graph', 'graph'], ['preview', 'preview'], ['test', 'tests'], ['org-preview', 'org-preview']] as const) {
      await attached?.unmount();
      await act(async () => { await exec('panel.open', { tool }); });
      expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: `studio-${tool}` });
      attached = await hostTab(tool);
      expect(attached.el.querySelector(`[data-testid="studio-view-${target}"][data-agent="${QC}"]`)).toBeTruthy();
      const saved = readStudioLayout(LAYOUT_KEY);
      expect(saved.tabs.map(tab => tab.id)).toEqual(documents.map(tab => tab.id));
      expect(saved.activeTab).toBe(scriptTabId(QC));
      expect(saved.workspaces[QC].panelViews).toContain(target);
      expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('flex');
      expect(el.querySelector('.sf-etab[data-kind="view"]')).toBeNull();
    }
  });

  it('keeps each agent Preview mounted across Assistant, closed tabs, and agent switches', async () => {
    const el = await mount(QC);
    await ready(el);
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    await act(async () => { await exec('panel.open', { tool: 'preview' }); });
    const original = await hostTab('preview', 'proj-1', 'preview-original');
    const qcPreview = original.el.querySelector<HTMLElement>(`[data-agent="${QC}"] [data-testid="stub-preview"]`)!;
    await act(async () => { fireEvent.click(qcPreview.querySelector('[data-testid="stub-run"]')!); });
    expect(qcPreview.dataset.runs).toBe('1');
    await original.unmount(); // The host may show Assistant or close this tab entirely.
    expect(control.options.state()).toMatchObject({ panels: { kept: ['preview'], active: null, open: false } });
    const reopened = await hostTab('preview', 'proj-1', 'preview-reopened');
    expect(reopened.el.querySelector(`[data-agent="${QC}"] [data-testid="stub-preview"]`)).toBe(qcPreview);
    await act(async () => { await exec('file.open', { path: HELP }); });
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    const helpPreview = reopened.el.querySelector<HTMLElement>(`[data-agent="${HELP}"] [data-testid="stub-preview"]`)!;
    expect(helpPreview).toBeTruthy();
    expect(helpPreview.dataset.runs).toBe('0');
    expect(qcPreview.closest<HTMLElement>('[data-agent]')!.style.display).toBe('none');
    await act(async () => { fireEvent.click(helpPreview.querySelector('[data-testid="stub-run"]')!); });
    await act(async () => { el.querySelector<HTMLButtonElement>(`[role="tab"][title="${QC}"]`)!.click(); });
    await flush();
    expect(reopened.el.querySelector(`[data-agent="${QC}"] [data-testid="stub-preview"]`)).toBe(qcPreview);
    expect(qcPreview.dataset.runs).toBe('1');
    expect(qcPreview.closest<HTMLElement>('[data-agent]')!.style.display).toBe('');
    expect(helpPreview.closest<HTMLElement>('[data-agent]')!.style.display).toBe('none');
    expect(helpPreview.dataset.runs).toBe('1');
    expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('flex');
  });

  it('pins Preview while editing another agent, then resumes following without remounting either session', async () => {
    const el = await mount(QC);
    await ready(el);
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    const preview = await hostTab('preview');
    const pane = (path: string) => preview.el.querySelector<HTMLElement>(`[data-testid="studio-view-preview"][data-agent="${path}"]`)!;
    const original = pane(QC).querySelector('[data-testid="stub-preview"]');
    await act(async () => { pane(QC).querySelector<HTMLButtonElement>('[aria-label="Pin Preview to QC.agent"]')!.click(); });
    await act(async () => { await exec('file.open', { path: HELP }); });
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    expect(pane(QC).style.display).toBe('');
    expect(pane(QC).textContent).toContain('Pinned');
    expect(el.querySelector(`[role="tab"][title="${HELP}"]`)?.getAttribute('aria-selected')).toBe('true');
    expect(pane(QC).querySelector('[data-testid="stub-preview"]')).toBe(original);
    await act(async () => { pane(QC).querySelector<HTMLButtonElement>('[aria-label="Follow selected agent"]')!.click(); });
    await flush();
    expect(pane(QC).style.display).toBe('none');
    expect(pane(HELP).style.display).toBe('');
    expect(pane(HELP).textContent).toContain('Follows selected agent');
    // A pin on Preview does not redirect Tests to that owner.
    await act(async () => { await exec('file.open', { path: QC }); });
    await act(async () => { pane(QC).querySelector<HTMLButtonElement>('[aria-label="Pin Preview to QC.agent"]')!.click(); });
    await act(async () => { await exec('file.open', { path: HELP }); });
    await preview.unmount();
    const tests = await hostTab('test');
    expect(tests.el.querySelector<HTMLElement>(`[data-testid="studio-view-tests"][data-agent="${HELP}"]`)?.style.display).toBe('');
    const reopened = await hostTab('preview');
    expect(reopened.el.querySelector<HTMLElement>(`[data-testid="studio-view-preview"][data-agent="${QC}"]`)?.style.display).toBe('');
    // Explicit editor commands use the editor's agent, even when this host tab was pinned.
    await act(async () => { await exec('panel.open', { tool: 'preview' }); });
    await flush();
    expect(reopened.el.querySelector<HTMLElement>(`[data-testid="studio-view-preview"][data-agent="${HELP}"]`)?.style.display).toBe('');
  });

  it('restores a pinned tool before its inactive owner editor has loaded', async () => {
    const a = { path: QC, label: 'QC.agent' }, b = { path: HELP, label: 'Help.agent' };
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ agents: [a, b], activeAgent: HELP, workspaces: {
      [QC]: { tabs: [scriptTab(a)], activeTab: scriptTabId(QC), panelViews: ['preview'], rail: 'preview' },
      [HELP]: { tabs: [scriptTab(b)], activeTab: scriptTabId(HELP) },
    } }));
    localStorage.setItem('salesforce:studio:pins:proj-1', JSON.stringify({ preview: QC }));
    const el = await mount(HELP);
    await ready(el);
    const preview = await hostTab('preview');
    const pinned = preview.el.querySelector<HTMLElement>(`[data-agent="${QC}"]`)!;
    expect(pinned.style.display).toBe('');
    expect(pinned.textContent).toContain('Pinned');
    expect(el.querySelector(`[role="tab"][title="${HELP}"]`)?.getAttribute('aria-selected')).toBe('true');
    // A refused explicit request must leave the pinned run visible.
    navigate.openPanelTool.mockReturnValue(false);
    await act(async () => { await exec('panel.open', { tool: 'preview' }); });
    expect(pinned.style.display).toBe('');
    expect(pinned.querySelector('[aria-label="Follow selected agent"]')).toBeTruthy();
  });

  it('returns to a closed owner through Active runs and selects its role-play tool', async () => {
    const el = await mount(QC);
    await ready(el);
    await act(async () => { updateStudioRun({ pluginId: 'salesforce', projectId: 'proj-1', path: QC, orgAlias: 'dev', view: 'roleplay' }, { runId: 'roleplay-1', engine: 'simulate', status: 'running', turn: 2 }); });
    await act(async () => { await exec('file.open', { path: HELP }); });
    await act(async () => { el.querySelector<HTMLButtonElement>('[aria-label="Close agent QC.agent"]')!.click(); });
    await act(async () => { el.querySelector<HTMLButtonElement>('[aria-label="Active runs"]')!.click(); });
    const entry = Array.from(el.querySelectorAll<HTMLButtonElement>('.sf-studio-runs-list button')).find(button => button.textContent?.includes('QC.agent'))!;
    expect(entry.textContent).toContain('Role-play');
    await act(async () => { entry.click(); });
    await flush();
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-test' });
    const tests = await hostTab('test');
    expect(tests.el.querySelector<HTMLElement>(`[data-agent="${QC}"]`)?.style.display).toBe('');
    expect(tests.el.querySelector('[data-testid="stub-lab"]')).toBeTruthy();
    expect(el.querySelector(`[role="tab"][title="${QC}"]`)?.getAttribute('aria-selected')).toBe('true');
  });

  it('pins each retained Org preview session to the agent and org named in its header', async () => {
    rpc.mockImplementation(async (pluginId: string, method: string, args?: any) => {
      if (method === 'agentPreview.context') return { ok: true, fields: [] };
      if (method === 'agentLab.start') return { ok: true, data: { id: `session:${args.path}`, turns: [{ role: 'agent', text: `Welcome ${args.path}` }] } };
      if (method === 'agentLab.end') return { ok: true, data: { id: args.id } };
      return baseRpc(pluginId, method, args);
    });
    const el = await mount(QC);
    await ready(el);
    const panel = await hostTab('org-preview');
    const pane = (path: string) => panel.el.querySelector<HTMLElement>(`[data-testid="studio-view-org-preview"][data-agent="${path}"]`)!;
    const start = async (path: string) => {
      const button = pane(path).querySelector<HTMLButtonElement>('[data-testid="salesforce-agentforce-preview-start"]')!;
      await waitFor(() => expect(button.disabled).toBe(false));
      await act(async () => { button.click(); });
      await flush();
      expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.start', expect.objectContaining({ projectId: 'proj-1', path, orgAlias: 'dev' }));
    };
    expect(pane(QC).querySelector('[data-testid="salesforce-preview-pinned"]')?.getAttribute('title')).toBe(QC);
    expect(pane(QC).querySelector('[data-testid="salesforce-preview-org"]')?.textContent).toBe('dev');
    await start(QC);
    await act(async () => { await exec('file.open', { path: HELP }); });
    await flush();
    expect(pane(HELP).querySelector('[data-testid="salesforce-preview-pinned"]')?.getAttribute('title')).toBe(HELP);
    expect(pane(HELP).querySelector('[aria-label="Agentforce preview file"]')).toBeNull();
    await start(HELP);
    expect(pane(QC).querySelector('[data-testid="salesforce-agentforce-preview-end"]')).toBeTruthy();
    expect(rpc.mock.calls.filter(call => call[1] === 'agentLab.end')).toHaveLength(0);
    await act(async () => { el.querySelector<HTMLButtonElement>(`[role="tab"][title="${QC}"]`)!.click(); });
    await flush();
    expect(pane(QC).textContent).toContain(`Welcome ${QC}`);
    expect(pane(HELP).textContent).toContain(`Welcome ${HELP}`);
    expect(rpc.mock.calls.filter(call => call[1] === 'agentLab.end')).toHaveLength(0);
  });

  it('migrates saved view tabs into the host panel and restores Script in their place', async () => {
    seedWorkspace([scriptTab({ path: QC, label: 'QC.agent' }), viewTab('preview'), viewTab('graph'), viewTab('tests')], 'view:graph');
    const el = await mount(QC);
    await ready(el);
    const graph = await hostTab('graph');
    const saved = readStudioLayout(LAYOUT_KEY);
    expect(saved.tabs.map(tab => tab.id)).toEqual([scriptTabId(QC)]);
    expect(saved.activeTab).toBe(scriptTabId(QC));
    expect(saved.workspaces[QC]).toMatchObject({ rail: 'graph', panelViews: ['preview', 'graph', 'tests'] });
    expect(graph.el.querySelector(`[data-testid="studio-view-graph"][data-agent="${QC}"]`)).toBeTruthy();
    expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('flex');
    expect(el.querySelector('.sf-etab[data-kind="view"]')).toBeNull();
  });

  it.each(['graph', 'preview', 'test', 'org-preview'] as const)('handles the host New Tab launcher for %s before an agent is open', async tool => {
    const el = await mount();
    await ready(el);
    const panel = await hostTab(tool);
    expect(panel.el.textContent).toContain('Open an agent');
    expect(panel.el.querySelector('[data-agent]')).toBeNull();
    expect(navigate.openPanelTool).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some(call => /preview\.start|simulations\.start|suites\.start/.test(call[1]))).toBe(false);
    await act(async () => { await exec('file.open', { path: QC }); });
    await flush();
    const target = tool === 'test' ? 'tests' : tool;
    expect(panel.el.querySelector(`[data-testid="studio-view-${target}"][data-agent="${QC}"]`)).toBeTruthy();
    expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('flex');
    expect(el.querySelector('.sf-etab[data-kind="view"]')).toBeNull();
  });

  it('falls back to an editor view when no host tool exists and recovers on the next accepted view', async () => {
    navigate.openPanelTool.mockReturnValue(false);
    const el = await mount(QC);
    await ready(el);
    await act(async () => { await exec('panel.open', { tool: 'preview' }); });
    expect(el.querySelector('[data-testid="studio-view-preview"] [data-testid="stub-preview"]')).toBeTruthy();
    expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('none');
    expect(readStudioLayout(LAYOUT_KEY).activeTab).toBe('view:preview');
    navigate.openPanelTool.mockReturnValue(true);
    await act(async () => { await exec('panel.open', { tool: 'graph' }); });
    const graph = await hostTab('graph');
    expect(graph.el.querySelector('[data-testid="studio-view-graph"]')).toBeTruthy();
    expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('flex');
    expect(readStudioLayout(LAYOUT_KEY).tabs.map(tab => tab.kind)).toEqual(['agent']);
    expect(readStudioLayout(LAYOUT_KEY).workspaces[QC].panelViews).toEqual(expect.arrayContaining(['preview', 'graph']));
  });

  it('recovers a refused view when the host New Tab launcher attaches directly', async () => {
    navigate.openPanelTool.mockReturnValue(false);
    const el = await mount(QC);
    await ready(el);
    await act(async () => { await exec('panel.open', { tool: 'test' }); });
    expect(el.querySelector('[data-testid="studio-view-tests"]')).toBeTruthy();
    const callsBeforeAttach = navigate.openPanelTool.mock.calls.length;
    const panel = await hostTab('test');
    expect(panel.el.textContent).not.toContain('needs Agent Script Studio');
    expect(panel.el.querySelector(`[data-testid="studio-view-tests"][data-agent="${QC}"]`)).toBeTruthy();
    expect(navigate.openPanelTool.mock.calls.length).toBe(callsBeforeAttach);
    expect(control.options.state().panels).toMatchObject({ host: true, active: 'test' });
    expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('flex');
    expect(readStudioLayout(LAYOUT_KEY).tabs.map(tab => tab.kind)).toEqual(['agent']);
  });

  it.each(['actions', 'graph'] as const)('keeps a running Preview intact when the host refuses %s, then permits recovery', async tool => {
    const el = await mount(QC);
    await ready(el);
    await act(async () => { await exec('panel.open', { tool: 'preview' }); });
    const preview = await hostTab('preview');
    const body = preview.el.querySelector<HTMLElement>('[data-testid="stub-preview"]')!;
    await act(async () => { fireEvent.click(body.querySelector('[data-testid="stub-run"]')!); });
    navigate.openPanelTool.mockReturnValue(false);
    await act(async () => { await exec('panel.open', { tool }); });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Could not open the tool in the side panel');
    expect(preview.el.querySelector('[data-testid="stub-preview"]')).toBe(body);
    expect(body.dataset.runs).toBe('1');
    expect(el.querySelector<HTMLElement>('.sf-frame-stage')!.style.display).toBe('flex');
    expect(readStudioLayout(LAYOUT_KEY).tabs.map(tab => tab.kind)).toEqual(['agent']);
    navigate.openPanelTool.mockReturnValue(true);
    await act(async () => { await exec('panel.open', { tool }); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: `studio-${tool}` });
    await preview.unmount();
    const recovered = await hostTab(tool);
    expect(recovered.el.querySelector(tool === 'actions' ? '.af-actions-list' : '[data-testid="studio-view-graph"]')).toBeTruthy();
    await recovered.unmount();
    const again = await hostTab('preview');
    expect(again.el.querySelector('[data-testid="stub-preview"]')).toBe(body);
    expect(body.dataset.runs).toBe('1');
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

  it.each([true, false, undefined])('keeps self-healing beside Studio when the host accepts its draft (%s)', async available => {
    if (available !== undefined) navigate.openPanelAgent = vi.fn(() => available);
    const path = 'force-app/bots/QC.agent';
    const batch = { id: 'baseline', agentPath: path, status: 'done', engine: 'preview', startedAt: 1, startedBy: 'studio',
      counts: { pass: 1, fail: 1, total: 2, error: 0, stopped: 0 }, lanes: [] };
    let run: any = null;
    rpc.mockImplementation(async (p: string, method: string, args?: any) => {
      if (method === 'studio.simulations.list') return { ok: true, batches: [batch] };
      if (method === 'studio.simulations.get') return { ok: true, batch };
      if (method === 'studio.selfHealing.status') return { ok: true, run };
      if (method === 'studio.selfHealing.start') {
        run = { id: 'healing-run', agentPath: path, bestBatchId: batch.id, baselinePass: 1, bestPass: 1, total: 2,
          maxAttempts: args.maxAttempts, attempts: [], status: 'awaiting_candidate' };
        return { ok: true, run };
      }
      return baseRpc(p, method, args);
    });
    const el = await mount(path);
    await ready(el);
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    await act(async () => { await exec('simulations.open'); });
    await flush();
    const testTab = await hostTab('test');
    const button = (name: string) => [...testTab.el.querySelectorAll<HTMLButtonElement>('.sf-sim-healing button')].find(b => b.textContent === name)!;
    await waitFor(() => expect(button('Ask assistant to improve')?.disabled).toBe(false));
    await act(async () => { button('Ask assistant to improve').click(); });
    await flush();
    const prompt = expect.stringContaining('Run id: healing-run. Budget: 3 candidate attempts.');
    expect(testTab.el.querySelector('[data-testid="studio-simulations"]')).toBeTruthy();
    if (available) {
      expect(navigate.openPanelAgent).toHaveBeenLastCalledWith({ draft: { prompt, view: path, projectId: 'proj-1' }, title: 'QC.agent' });
      expect(navigate.toCompose).not.toHaveBeenCalled();
      // A kept pane's handoff still belongs to its agent after another file opens.
      await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
      await flush();
      await act(async () => { button('Continue with assistant').click(); });
      expect(navigate.openPanelAgent).toHaveBeenLastCalledWith({ draft: { prompt, view: path, projectId: 'proj-1' }, title: 'QC.agent' });
      expect(navigate.toCompose).not.toHaveBeenCalled();
    } else {
      expect(navigate.toCompose).toHaveBeenCalledWith({ initialPrompt: prompt, focusPrompt: true });
    }
    expect(rpc.mock.calls.some(c => c[1] === 'studio.askAgent')).toBe(false);
  });

  it('opens an org-test assistant without a selected agent file', async () => {
    navigate.openPanelAgent = vi.fn(() => true);
    const el = await mount();
    await ready(el);
    await act(async () => { await exec('orgTests.open'); });
    await flush();
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="stub-org-tests-ask"]')!.click(); });
    expect(navigate.openPanelAgent).toHaveBeenLastCalledWith({
      draft: { prompt: expect.stringContaining('Explain this org test'), projectId: 'proj-1' }, title: 'Agent tests'
    });
    expect(navigate.toCompose).not.toHaveBeenCalled();
  });

  it('drafts graph coverage cases for the graph agent after switching to another file', async () => {
    navigate.openPanelAgent = vi.fn(() => true);
    const path = 'force-app/bots/QC.agent';
    const el = await mount(path);
    await ready(el);
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    await act(async () => { await exec('graph.focus', { node: 'welcome' }); });
    const graph = await hostTab('graph');
    await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
    await flush();
    const draft = graph.el.querySelector<HTMLButtonElement>(`[data-testid="studio-view-graph"][data-agent="${path}"] [data-testid="stub-graph-draft"]`)!;
    await act(async () => { draft.click(); });
    expect(navigate.openPanelAgent).toHaveBeenLastCalledWith({
      draft: { prompt: expect.stringContaining(`Source: ${path}`), view: path, projectId: 'proj-1' }, title: 'QC.agent'
    });
    expect(navigate.openPanelAgent.mock.calls.at(-1)![0].draft.prompt).toContain('welcome');
    expect(navigate.toCompose).not.toHaveBeenCalled();
  });

  it('B: Inspect <action> from the Graph view opens it over an open dependency tab', async () => {
    const el = await mount({ subPath: 'force-app/bots/QC.agent', params: { path: 'force-app/bots/QC.agent', apiName: 'OrderLookup', readOnly: '1' } });
    const tab = await hostTab('actions');
    await ready(el);
    const actions = parseAgentScriptSource(ACTION_AGENT, 'agentforce').actions;
    const refund = actions.find(action => action.name === 'refund')!;
    await post(el, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    await post(el, { type: 'openAction', id: refund.id });
    const pressed = () => [...tab.el.querySelectorAll('.af-related-tabs [aria-pressed="true"]')].map(b => b.textContent);
    expect(pressed()).toEqual(['refund']);
    await act(async () => { [...tab.el.querySelectorAll<HTMLButtonElement>('.af-related-tabs button')].find(b => b.textContent === 'OrderLookup')!.click(); });
    expect(pressed()).toEqual(['OrderLookup']);
    (globalThis as any).__graphInspect = refund.id;
    await act(async () => { await exec('graph.focus', { node: 'refund' }); });
    const graph = await hostTab('graph');
    const inspect = graph.el.querySelector<HTMLButtonElement>('[data-testid="studio-view-graph"] [data-testid="stub-graph-inspect"]')!;
    await act(async () => { inspect.click(); });
    await flush();
    expect(pressed()).toEqual(['refund']);
    await tab.unmount();
  });

  it('B: Inspect in the Graph view of an agent that is not loaded opens that agent, then the action', async () => {
    const el = await mount('force-app/bots/QC.agent');
    const tab = await hostTab('actions');
    await ready(el);
    const actions = parseAgentScriptSource(ACTION_AGENT, 'agentforce').actions;
    const refund = actions.find(action => action.name === 'refund')!;
    await post(el, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    await act(async () => { await exec('graph.focus', { node: 'refund' }); });
    const graph = await hostTab('graph');
    await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'setFile').at(-1)).toMatchObject({ path: 'force-app/bots/Help.agent' });
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    // QC's graph pane stays mounted behind Help: inspecting there loads QC first.
    (globalThis as any).__graphInspect = refund.id;
    const inspect = graph.el.querySelector<HTMLButtonElement>('[data-testid="studio-view-graph"][data-agent="force-app/bots/QC.agent"] [data-testid="stub-graph-inspect"]')!;
    await act(async () => { inspect.click(); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'setFile').at(-1)).toMatchObject({ path: 'force-app/bots/QC.agent' });
    expect(tab.el.querySelector('.af-related-tabs')).toBeNull();
    // A snapshot without the action (or of another agent) opens nothing; QC's snapshot opens it once.
    await post(el, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    expect([...tab.el.querySelectorAll('.af-related-tabs [aria-pressed="true"]')].map(b => b.textContent)).toEqual(['refund']);
    await act(async () => { tab.el.querySelector<HTMLButtonElement>('[aria-label="Close refund"]')!.click(); });
    await post(el, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    expect(tab.el.querySelector('.af-related-tabs')).toBeNull();
    await tab.unmount();
  });

  it('B: a failed or superseded agent load drops the pending Inspect', async () => {
    const el = await mount('force-app/bots/QC.agent');
    const tab = await hostTab('actions');
    await ready(el);
    const actions = parseAgentScriptSource(ACTION_AGENT, 'agentforce').actions;
    const refund = actions.find(action => action.name === 'refund')!;
    await post(el, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    await act(async () => { await exec('graph.focus', { node: 'refund' }); });
    const graph = await hostTab('graph');
    await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
    await flush();
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    (globalThis as any).__graphInspect = refund.id;
    const inspect = () => graph.el.querySelector<HTMLButtonElement>('[data-testid="studio-view-graph"][data-agent="force-app/bots/QC.agent"] [data-testid="stub-graph-inspect"]')!;
    // The read fails: nothing waits for QC's snapshot.
    rpc.mockImplementation(async (p: string, method: string, args?: any) => method === 'agentFiles.read' ? { ok: false, error: 'gone' } : baseRpc(p, method, args));
    await act(async () => { inspect().click(); });
    await flush();
    rpc.mockImplementation(baseRpc);
    await act(async () => { await exec('file.open', { path: 'force-app/bots/QC.agent' }); });
    await flush();
    await post(el, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    expect(tab.el.querySelector('.af-related-tabs')).toBeNull();
    // A thrown read drops it too.
    await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
    await flush();
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    rpc.mockImplementation(async (p: string, method: string, args?: any) => { if (method === 'agentFiles.read') throw Error('offline'); return baseRpc(p, method, args); });
    await act(async () => { inspect().click(); });
    await flush();
    rpc.mockImplementation(baseRpc);
    await act(async () => { await exec('file.open', { path: 'force-app/bots/QC.agent' }); });
    await flush();
    await post(el, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    expect(tab.el.querySelector('.af-related-tabs')).toBeNull();
    // Another agent opened before QC's snapshot supersedes the request.
    await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
    await flush();
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    await act(async () => { inspect().click(); });
    await flush();
    await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
    await flush();
    await act(async () => { await exec('file.open', { path: 'force-app/bots/QC.agent' }); });
    await flush();
    await post(el, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    expect(tab.el.querySelector('.af-related-tabs')).toBeNull();
    await tab.unmount();
  });
});

describe('Open agent picker recovery', () => {
  beforeEach(() => { rpc.mockImplementation(baseRpc); });

  const openPicker = async (el: HTMLElement) => {
    await act(async () => { el.querySelector<HTMLButtonElement>('.sf-atab-add')!.click(); });
    const dialog = el.querySelector<HTMLElement>('[role="dialog"][aria-label="Quick open"]')!;
    expect(dialog).toBeTruthy();
    return dialog;
  };
  const pickHelp = async (el: HTMLElement) => {
    const dialog = await openPicker(el);
    await act(async () => { fireEvent.change(dialog.querySelector('input')!, { target: { value: 'Help' } }); });
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Enter' }); });
    await flush();
  };

  it('opens another agent from the picker while Tests is in front, and selects its Script', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    await act(async () => { await exec('panel.open', { tool: 'test' }); });
    const tests = await hostTab('test');
    expect(tests.el.querySelector('[data-testid="studio-view-tests"][data-agent="force-app/bots/QC.agent"]')).toBeTruthy();
    await pickHelp(el);
    expect(el.querySelector('[role="dialog"][aria-label="Quick open"]')).toBeNull();
    expect(el.querySelector('.sf-atab.is-active')?.textContent).toContain('Help.agent');
    expect(el.querySelector('.sf-etab.is-active')?.textContent).toContain('Script');
    expect(sent(el).filter((message: any) => message.type === 'setFile').at(-1)).toMatchObject({ path: 'force-app/bots/Help.agent' });
  });

  it.each(['transport', 'response'] as const)('preserves the current agent on a %s failure, displays the error and permits retry', async failure => {
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const actions = parseAgentScriptSource(ACTION_AGENT, 'agentforce').actions;
    await post(el, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    const tab = await hostTab('actions');
    expect(tab.el.querySelector('.af-actions-list')?.textContent).toContain('refund');
    let finish!: () => void;
    rpc.mockImplementation(async (pluginId: string, method: string, args?: any) => {
      if (method === 'agentFiles.read' && args?.path === 'force-app/bots/Help.agent') {
        await new Promise<void>(resolve => { finish = resolve; });
        if (failure === 'transport') throw Error('Agent file connection lost');
        return { ok: false, error: 'Agent file connection lost' };
      }
      return baseRpc(pluginId, method, args);
    });
    await pickHelp(el);
    // The file switch is committed only after the requested file has been read.
    expect(tab.el.querySelector('.af-actions-list')?.textContent).toContain('refund');
    await act(async () => { finish(); });
    await flush();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Agent file connection lost');
    expect(el.querySelector('.sf-atab.is-active')?.textContent).toContain('QC.agent');
    expect(tab.el.querySelector('.af-actions-list')?.textContent).toContain('refund');
    rpc.mockImplementation(baseRpc);
    await pickHelp(el);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelector('.sf-atab.is-active')?.textContent).toContain('Help.agent');
  });

  it('recovers from a rejected first read without disabling subsequent agent tab selection', async () => {
    let rejectInitial = true;
    rpc.mockImplementation(async (pluginId: string, method: string, args?: any) => {
      if (method === 'agentFiles.read' && rejectInitial) { rejectInitial = false; throw Error('Initial read unavailable'); }
      return baseRpc(pluginId, method, args);
    });
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Initial read unavailable');
    await pickHelp(el);
    await act(async () => { await exec('file.open', { path: 'force-app/bots/QC.agent' }); });
    await act(async () => { el.querySelector<HTMLButtonElement>('[role="tab"][title="force-app/bots/Help.agent"]')!.click(); });
    await flush();
    expect(sent(el).filter((message: any) => message.type === 'setFile').at(-1)).toMatchObject({ path: 'force-app/bots/Help.agent' });
  });
});

it('restores the loaded agent after a rejected existing-tab switch so that the same tab can be retried', async () => {
  rpc.mockImplementation(baseRpc);
  const el = await mount('force-app/bots/QC.agent');
  await ready(el);
  await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
  await act(async () => { await exec('file.open', { path: 'force-app/bots/QC.agent' }); });
  rpc.mockImplementation(async (pluginId: string, method: string, args?: any) => {
    if (method === 'agentFiles.read' && args?.path === 'force-app/bots/Help.agent') throw Error('Help temporarily unavailable');
    return baseRpc(pluginId, method, args);
  });
  const help = () => el.querySelector<HTMLButtonElement>('[role="tab"][title="force-app/bots/Help.agent"]')!;
  await act(async () => { help().click(); });
  await flush();
  expect(el.querySelector('[role="alert"]')?.textContent).toContain('Help temporarily unavailable');
  expect(el.querySelector('.sf-atab.is-active')?.textContent).toContain('QC.agent');
  expect(sent(el).filter((message: any) => message.type === 'setFile').at(-1)).toMatchObject({ path: 'force-app/bots/QC.agent' });
  rpc.mockImplementation(baseRpc);
  await act(async () => { help().click(); });
  await flush();
  expect(el.querySelector('.sf-atab.is-active')?.textContent).toContain('Help.agent');
  expect(sent(el).filter((message: any) => message.type === 'setFile').at(-1)).toMatchObject({ path: 'force-app/bots/Help.agent' });
});
