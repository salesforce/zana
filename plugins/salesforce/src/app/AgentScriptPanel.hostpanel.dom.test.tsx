/**
 * @vitest-environment happy-dom
 */
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';

const control: { options?: any } = {};
vi.mock('./useSalesforceControl.js', async importOriginal => ({ ...(await importOriginal<object>()), useSalesforceControl: (options: unknown) => { control.options = options; } }));
vi.mock('./preview/PreviewWorkbench.js', () => ({ PreviewWorkbench: (p: any) => <div data-testid="stub-preview" data-engine={p.engine} data-dirty={String(Boolean(p.dirty))} data-command={p.command ? JSON.stringify(p.command) : ""}><button data-testid="stub-run" onClick={() => p.onRunChange({ runId: 'r1', engine: 'live', turn: 1 })}>run</button><button data-testid="stub-handled" onClick={() => p.onCommandHandled(p.command?.seq ?? -1)}>handled</button><button data-testid="stub-stale" onClick={() => p.onCommandHandled(0)}>stale</button></div> }));
vi.mock('./studio/AskAgentButton.js', () => ({ AskAgentButton: () => <div data-testid="stub-ask-agent" /> }));
vi.mock('./AgentScriptGraphPanel.js', () => ({ AgentScriptGraphPanel: (p: any) => <div data-testid="stub-graph" data-focus={`${p.focusNode}:${p.focusSeq}`} data-compact={String(p.compact)}><button data-testid="stub-graph-draft" onClick={() => p.onDraftCases(["welcome"])}>draft cases</button><button data-testid="stub-graph-inspect" onClick={() => p.onOpenAction((globalThis as any).__graphInspect)}>inspect</button></div> }));
vi.mock('./studio/OrgTestsView.js', () => ({ OrgTestsView: (p: any) => <button data-testid="stub-org-tests-ask" onClick={() => p.onAskAgent('Explain this org test')}>ask about org test</button> }));
vi.mock('./OrgAgentsPanel.js', () => ({ OrgAgentsPanel: (p: any) => <div data-testid="stub-agents"><button data-testid="stub-agents-open" onClick={() => p.onLocalOpen?.('force-app/bots/Help.agent')}>open</button></div> }));
vi.mock('./AgentforceLabPanel.js', () => ({ AgentforceLabPanel: () => <div data-testid="stub-lab" /> }));
vi.mock('./panels/OperationsPanel.js', () => ({ OperationsPanel: () => <div data-testid="stub-ops" /> }));
const { AgentScriptPanel } = await import('./AgentScriptPanel.js');
const { StudioPanelTool } = await import('./studio/StudioPanelTool.js');
const { resetStudioToolBridge } = await import('./studio/studio-tool-bridge.js');
const { readStudioLayout } = await import('./studio/studio-layout.js');
const { parseAgentScriptSource } = await import('../../lib/agent-script-parse.js');
const { ACTION_AGENT } = await import('../action-fixtures.js');

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
async function hostTab(tool: 'actions' | 'comments', projectId = 'proj-1', tabId?: string) {
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
    // The host panel has its own toggle, so Studio shows none; with nothing shown yet, opening the panel shows Preview.
    expect(el.querySelector('[aria-label="Show side panel"]')).toBeNull();
    await act(async () => { await exec('panel.show'); });
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-actions' });
    navigate.openPanelTool.mockClear();
    // Preview is an editor view tab: it never goes to the host panel.
    await act(async () => { fireEvent.click(el.querySelector('[data-testid="salesforce-agent-script-preview"]')!); });
    expect(navigate.openPanelTool).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="studio-view-preview"] [data-testid="stub-preview"]')).toBeTruthy();
    const tab = await hostTab('actions');
    const list = tab.el.querySelector('.af-actions-list')!;
    expect(list).toBeTruthy();
    expect(el.querySelector('.af-actions-list')).toBeNull();
    expect(control.options.state()).toMatchObject({ tool: 'actions', panels: { host: true, tabs: ['actions'], kept: [], active: 'actions', open: true } });
    // Commands reach the view tab in the editor.
    await act(async () => { await exec('preview.send', { text: 'hi', engine: 'live' }); });
    await flush();
    expect(JSON.parse(el.querySelector('[data-testid="stub-preview"]')!.getAttribute('data-command')!)).toMatchObject({ type: 'send', text: 'hi' });
    await tab.unmount();
    // A tab switched away or closed is not reported as shown; Studio keeps the tool running.
    expect(control.options.state()).toMatchObject({ panels: { host: true, tabs: [], kept: ['actions'], active: null, open: false } });
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
    expect(navigate.openPanelTool).toHaveBeenLastCalledWith({ actionId: 'studio-actions' });
    await expect(exec('panel.hide')).rejects.toThrow('ZCC side panel');
    await expect(exec('panel.close', { tool: 'actions' })).rejects.toThrow('ZCC side panel');
  });

  it('starts a tool fresh in a reopened tab and keeps it within the same tab', async () => {
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
    const fresh = reopened.el.querySelector('.af-actions-list');
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(list);
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

  it('turns the compact strip into a launcher instead of swapping the editor', async () => {
    width = 500;
    const el = await mount('force-app/bots/QC.agent');
    await ready(el);
    const strip = el.querySelector('[aria-label="Studio tools"]')!;
    const tab = (name: RegExp) => [...strip.querySelectorAll('[role="tab"]')].find(t => name.test(t.getAttribute('aria-label') ?? t.textContent ?? ''))!;
    await act(async () => { fireEvent.click(tab(/actions/i)); });
    expect(navigate.openPanelTool).toHaveBeenCalledWith({ actionId: 'studio-actions' });
    expect(el.querySelector('.af-workspace')!.getAttribute('data-mode')).toBe('editor');
    await act(async () => { fireEvent.click(tab(/code/i)); });
    expect(navigate.openPanelTool).toHaveBeenCalledTimes(1);
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
    const button = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('.sf-sim-healing button')].find(b => b.textContent === name)!;
    await waitFor(() => expect(button('Start self-healing')?.disabled).toBe(false));
    await act(async () => { button('Start self-healing').click(); });
    await flush();
    const prompt = expect.stringContaining('Run id: healing-run. Budget: 3 candidate attempts.');
    expect(el.querySelector('[data-testid="studio-simulations"]')).toBeTruthy();
    if (available) {
      expect(navigate.openPanelAgent).toHaveBeenLastCalledWith({ draft: { prompt, view: path, projectId: 'proj-1' }, title: 'QC.agent' });
      expect(navigate.toCompose).not.toHaveBeenCalled();
      // A kept pane's handoff still belongs to its agent after another file opens.
      await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
      await flush();
      await act(async () => { button('Continue with agent').click(); });
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
    await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
    await flush();
    const draft = el.querySelector<HTMLButtonElement>(`[data-testid="studio-view-graph"][data-agent="${path}"] [data-testid="stub-graph-draft"]`)!;
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
    const inspect = el.querySelector<HTMLButtonElement>('[data-testid="studio-view-graph"] [data-testid="stub-graph-inspect"]')!;
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
    await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'setFile').at(-1)).toMatchObject({ path: 'force-app/bots/Help.agent' });
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    // QC's graph pane stays mounted behind Help: inspecting there loads QC first.
    (globalThis as any).__graphInspect = refund.id;
    const inspect = el.querySelector<HTMLButtonElement>('[data-testid="studio-view-graph"][data-agent="force-app/bots/QC.agent"] [data-testid="stub-graph-inspect"]')!;
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
    await act(async () => { await exec('file.open', { path: 'force-app/bots/Help.agent' }); });
    await flush();
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0, actions: [] });
    (globalThis as any).__graphInspect = refund.id;
    const inspect = () => el.querySelector<HTMLButtonElement>('[data-testid="studio-view-graph"][data-agent="force-app/bots/QC.agent"] [data-testid="stub-graph-inspect"]')!;
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
