/**
 * @vitest-environment happy-dom
 * @vitest-environment-options {"settings":{"enableIframePageLoading":true}}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { fireEvent, renderHook, waitFor, within } from '@testing-library/react';
import { useAgentforceTarget } from './use-agentforce-target.js';
import { readAgentDraft, writeAgentDraft } from './agent-script-drafts.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentScriptPanel } from './AgentScriptPanel.js';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';
import { queueAgentScriptOpen } from './agent-script-open.js';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { ACTION_AGENT } from '../action-fixtures.js';
import { starterScenarios } from '../../lib/scenario-library-contract.js';

const rpc = vi.fn(async (_pluginId: string, method: string, args?: { path?: string; projectId?: string }) => {
  if (method === 'agentPreview.context') return { ok: true, fields: [] };
  if (method === 'studio.scenarios.list') return { ok: true, scenarios: starterScenarios() };
  if (method === 'status') {
    return { dxProject: true, agentScriptDialect: 'agentforce', projectRoot: '/proj' };
  }
  if (method === 'agentFiles.list') {
    return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }] };
  }
  if (method === 'org') {
    return {
      ok: true,
      org: {
        alias: 'dev',
        username: 'dev@example.com',
        orgId: '00Dxx',
        instanceUrl: 'https://example',
        apiVersion: '62.0',
        kind: 'sandbox',
        isDefault: true
      }
    };
  }
  if (method === 'orgs') {
    return {
      ok: true,
      selectedAlias: 'dev',
      orgs: [{ alias: 'dev', username: 'dev@example.com', kind: 'sandbox', isDefault: true, orgId: '', instanceUrl: '', connectedStatus: '' }]
    };
  }
  if (method === 'agentFiles.read') {
    return {
      ok: true,
      file: { path: args?.path ?? 'force-app/bots/QC.agent', content: 'start_agent:\n', sha256: 'abc' }
    };
  }
  if (method === 'agentFiles.write') {
    return { ok: true, file: { path: args?.path ?? 'force-app/bots/QC.agent', sha256: 'def' } };
  }
  return { ok: false };
});

const baseRpc = rpc.getMockImplementation()!;

describe('AgentScriptPanel', () => {
  const nodes: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function () { this.setAttribute('open', ''); });
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function () { this.removeAttribute('open'); });
    rpc.mockClear();
    rpc.mockImplementation(baseRpc);
    (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__ = {
      callRpc: rpc,
      useZccNavigate: () => ({ toCompose: vi.fn() }),
      getSettings: async () => ({ values: { agentScriptDialect: 'agentforce' } }),
      setSettings: async () => undefined
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useZccNavigate: () => ({ toCompose: vi.fn() }),
      useSettings: () => ({ values: { agentScriptDialect: 'agentforce', defaultOrg: 'dev' }, isLoading: false })
    };
  });

  afterEach(() => {
    for (const node of nodes.splice(0)) node.unmount();
    vi.restoreAllMocks();
    delete (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__;
    delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
  });

  async function mount(subPath = '', projectId = 'proj-1', orgPicker = true, extra: { onActivePath?: (path: string | null) => void; navigationTarget?: HTMLElement | null } = {}) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    nodes.push({
      unmount: () => {
        root.unmount();
        el.remove();
      }
    });
    await act(async () => {
      root.render(createElement(AgentScriptPanel, { pluginId: 'salesforce', subPath, projectId, orgPicker, ...extra }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return el;
  }

  it('renders the workbench chrome, explorer, and playground iframe', async () => {
    const el = await mount();
    expect(el.querySelector('[data-testid="salesforce-agent-script-panel"]')).toBeTruthy();
    expect(el.querySelector('iframe')?.getAttribute('title')).toBe('Agentforce playground');
    expect(el.querySelector('[aria-label="Agentforce dialect"]')).toBeNull();
    expect(el.querySelector('[aria-label="Agentforce file"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-agent-script-explorer"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-agent-script-file:force-app/bots/QC.agent"]')).toBeTruthy();
    expect(el.querySelector('select[aria-label="Agent Script file"]')).toBeNull();
    expect(el.querySelector('[aria-label="AgentScript tools"]')?.textContent).toContain('File explorer');
    // No file is open yet, so the bar offers Save as… alone; Save and its menu need a file.
    expect([...el.querySelectorAll('button')].some(b => b.textContent === 'Save as…')).toBe(true);
    expect(el.querySelector('[data-testid="salesforce-agent-script-save"]')).toBeNull();
    // The agent tabs bar carries the toolbar org switcher (alias + kind label over the native select).
    expect(el.querySelector('.sf-atabs-bar .sf-org-switcher [data-testid="salesforce-org-picker"]')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.list', { projectId: 'proj-1' });
    expect(rpc.mock.calls.some((call) => call[0] === 'salesforce' && call[1] === 'org')).toBe(true);
    expect(el.querySelector('[data-testid="salesforce-playground-org"]')?.textContent).toBe('dev (sandbox)');
  });

  it('portals file tabs into the project header while retaining Studio keyboard shortcuts', async () => {
    const target = document.createElement('header');
    document.body.appendChild(target);
    try {
      const el = await mount('force-app/bots/QC.agent', 'proj-1', false, { navigationTarget: target });
      await message(el, { type: 'ready' });
      const iframe = el.querySelector('iframe');
      expect(target.querySelector('[data-testid="salesforce-agent-tabs"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="salesforce-agent-tabs"]')).toBeNull();
      expect(within(target).getByRole('tab', { name: /^QC.agent/ })).toBeTruthy();
      const open = within(target).getByRole('button', { name: 'Open agent', exact: true });
      fireEvent.keyDown(open, { key: 'p', ctrlKey: true });
      await waitFor(() => expect(within(el).getByRole('dialog', { name: 'Quick open' })).toBeTruthy());
      expect(el.querySelector('iframe')).toBe(iframe);
    } finally { target.remove(); }
  });

  it('opens no example by default and offers to open or create an agent', async () => {
    const el = await mount();
    const post = vi.spyOn(el.querySelector('iframe')!.contentWindow!, 'postMessage');
    await message(el, { type: 'ready' });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'setFile', path: null, content: '', readOnly: true }), window.location.origin);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'init', examples: [] }), window.location.origin);
    const empty = el.querySelector('[data-testid="salesforce-agent-script-no-file"]') as HTMLElement;
    expect(empty.textContent).toContain('Open an agent');
    expect(([...el.querySelectorAll('button')].find(b => b.textContent === 'Save as…') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { ([...empty.querySelectorAll('button')].find(b => b.textContent === 'Create an agent') as HTMLButtonElement).click(); });
    expect(el.querySelector('dialog[open]')).toBeTruthy();
    await act(async () => { ([...empty.querySelectorAll('button')].find(b => b.textContent === 'Go to file') as HTMLButtonElement).click(); });
    await act(async () => { ([...empty.querySelectorAll('button')].find(b => b.textContent === 'Open org agents') as HTMLButtonElement).click(); });
  });

  it('opens a scanned file after the playground is ready and persists on request', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: el.querySelector("iframe")!.contentWindow,
          data: { source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' }
        })
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith(
      'salesforce',
      'agentFiles.read',
      expect.objectContaining({ path: 'force-app/bots/QC.agent', projectId: 'proj-1' })
    );
    const save = el.querySelector('[data-testid="salesforce-agent-script-save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: el.querySelector("iframe")!.contentWindow,
          data: {
            source: PLAYGROUND_BRIDGE_SOURCE,
            type: 'persist',
            path: 'force-app/bots/QC.agent',
            content: 'updated'
          }
        })
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith(
      'salesforce',
      'agentFiles.write',
      expect.objectContaining({ path: 'force-app/bots/QC.agent', content: 'updated', projectId: 'proj-1' })
    );
    expect([...el.querySelectorAll('.sf-as-tree-btn')].some(button => button.textContent?.includes('Support concierge'))).toBe(false);
    await act(async () => {
      (
        el.querySelector('[data-testid="salesforce-agent-script-file:force-app/bots/QC.agent"]') as HTMLButtonElement
      ).click();
    });
    expect(rpc).toHaveBeenCalledWith(
      'salesforce',
      'agentFiles.read',
      expect.objectContaining({ path: 'force-app/bots/QC.agent', projectId: 'proj-1' })
    );
  });

  it('reports the open agent file, then null once it goes away', async () => {
    const onActivePath = vi.fn();
    await mount('force-app/bots/QC.agent', 'proj-1', true, { onActivePath });
    expect(onActivePath).toHaveBeenLastCalledWith('force-app/bots/QC.agent');
    await act(async () => { nodes.pop()!.unmount(); });
    expect(onActivePath).toHaveBeenLastCalledWith(null);
  });

  it('opens a queued path after the playground is ready', async () => {
    queueAgentScriptOpen('proj-1', 'force-app/bots/QC.agent');
    const el = await mount();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: el.querySelector("iframe")!.contentWindow,
          data: { source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' }
        })
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith(
      'salesforce',
      'agentFiles.read',
      expect.objectContaining({ path: 'force-app/bots/QC.agent', projectId: 'proj-1' })
    );
  });

  it('follows Preview even while the previous agent file is still loading', async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementation((id, method, args) => method === 'agentFiles.read' && args?.path === 'force-app/bots/QC.agent'
      ? new Promise(resolve => { finish = resolve; }) as ReturnType<typeof baseRpc>
      : baseRpc(id, method, args));
    const selection = renderHook(() => useAgentforceTarget({ pluginId: 'salesforce', projectId: 'proj-1', surface: 'preview' }));
    const el = await mount('force-app/bots/QC.agent');
    await message(el, { type: 'ready' });
    await act(async () => { selection.result.current.select({ path: 'force-app/Orders.agent' }); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'force-app/Orders.agent' }));
    await act(async () => { finish({ ok: true, file: { path: 'force-app/bots/QC.agent', content: 'old', sha256: 'old' } }); });
    expect(el.querySelector('[aria-label="Agentforce file"]')?.textContent).toContain('Orders.agent');
    expect(selection.result.current.target?.path).toBe('force-app/Orders.agent');
    selection.unmount();
  });

  it('restores Preview ahead of the editor tab, including hiding before the file loads', async () => {
    const first = await mount('force-app/Support.agent');
    await message(first, { type: 'ready' });
    await act(async () => nodes.pop()!.unmount());
    const selection = renderHook(() => useAgentforceTarget({ pluginId: 'salesforce', projectId: 'proj-1', surface: 'preview' }));
    await act(async () => selection.result.current.select({ path: 'force-app/Orders.agent' }));
    let finish!: (value: unknown) => void;
    rpc.mockImplementation((id, method, args) => method === 'agentFiles.read' && args?.path === 'force-app/Orders.agent'
      ? new Promise(resolve => { finish = resolve; }) as ReturnType<typeof baseRpc>
      : baseRpc(id, method, args));
    const second = await mount();
    await message(second, { type: 'ready' });
    await act(async () => nodes.pop()!.unmount());
    await act(async () => { finish({ ok: true, file: { path: 'force-app/Orders.agent', content: 'late', sha256: 'late' } }); });
    rpc.mockImplementation(baseRpc);
    const restored = await mount();
    await message(restored, { type: 'ready' });
    expect(selection.result.current.target?.path).toBe('force-app/Orders.agent');
    expect(restored.querySelector('[aria-label="Agentforce file"]')?.textContent).toContain('Orders.agent');
    selection.unmount();
  });

  async function openTool(el: HTMLElement, name: string) {
    const tab = within(el).queryByRole('tab', { name, exact: true });
    if (tab) { await act(async () => { tab.click(); }); return; }
    await act(async () => { within(el).getByRole('button', { name: 'Add side panel tab' }).click(); });
    await act(async () => { within(el.querySelector('.af-tool-picker')!).getByRole('button', { name: new RegExp(`^${name}`) }).click(); });
  }

  async function openAgentFile(el: HTMLElement) {
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agent-script-file:force-app/bots/QC.agent"]')!.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  }
  async function openView(el: HTMLElement, name: string) {
    await act(async () => { within(el).getByRole('button', { name: `Open ${name} view` }).click(); });
  }

  it('opens a graph beside the same editor and can hide and restore the panel', async () => {
    const el = await mount('', 'proj-1', false);
    expect(within(el).queryByRole('combobox', { name: 'Salesforce org' })).toBeNull();
    expect(el.querySelector('.sf-as-header')).toBeNull();
    expect(el.querySelector('.sf-as-stage .af-document-bar')).toBeTruthy();
    const editor = el.querySelector('iframe[title="Agentforce playground"]')!;
    await openAgentFile(el);
    await openView(el, 'Graph');
    expect(within(el).getByRole('tab', { name: 'Graph' }).getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('iframe[title="Agentforce playground"]')).toBe(editor);
    expect(editor.style.display).not.toBe('none');
    expect(el.querySelector('iframe[title="AgentScript graph"]')).toBeTruthy();
    await act(async () => within(el).getAllByRole('button', { name: 'Hide side panel' })[0].click());
    expect(el.querySelector<HTMLElement>('.af-tools')!.hidden).toBe(true);
    await act(async () => within(el).getByRole('button', { name: 'Show side panel' }).click());
    expect(el.querySelector<HTMLElement>('.af-tools')!.hidden).toBe(false);
    expect(el.querySelector('iframe[title="Agentforce playground"]')).toBe(editor);
  });

  it('shows a load error when the playground iframe fails', async () => {
    const el = await mount();
    const iframe = el.querySelector('iframe');
    expect(iframe).toBeTruthy();
    await act(async () => {
      iframe?.dispatchEvent(new Event('error', { bubbles: true }));
    });
    expect(el.querySelector('[data-testid="salesforce-agent-script-playground-error"]')?.textContent).toMatch(
      /Could not load the Agentforce playground/
    );
    expect(el.querySelector('iframe')).toBeNull();
  });

  it('follows the shared org selector without losing the editor or applying stale responses', async () => {
    const el = await mount('', 'proj-1', false);
    const editor = el.querySelector('iframe');
    const response = await baseRpc('salesforce', 'org') as { ok: boolean; org: Record<string, unknown> };
    const pending: Array<(value: unknown) => void> = [];
    rpc.mockImplementation((id, method, args) => method === 'org'
      ? new Promise(resolve => pending.push(resolve)) as ReturnType<typeof baseRpc>
      : baseRpc(id, method, args));
    const change = (projectId: string | null) => window.dispatchEvent(new CustomEvent('sf:context-changed', { detail: { projectId } }));
    await act(async () => { change('another-project'); });
    expect(pending).toHaveLength(0);
    await act(async () => { change('proj-1'); change(null); });
    expect(pending).toHaveLength(2);
    await act(async () => pending[1]({ ...response, org: { ...response.org, alias: 'latest' } }));
    await act(async () => pending[0]({ ...response, org: { ...response.org, alias: 'stale' } }));
    expect(el.querySelector('[data-testid="salesforce-playground-org"]')?.textContent).toBe('latest (sandbox)');
    expect(el.querySelector('iframe')).toBe(editor);
    await act(async () => nodes.pop()!.unmount());
    change('proj-1');
    expect(pending).toHaveLength(2);
  });

  it('accepts draft snapshots only from its iframe and preserves labs between workflow views', async () => {
    const el = await mount();
    await openAgentFile(el);
    await openView(el, 'Preview');
    // Preview is the PreviewWorkbench (WS-6); its Start button replaced the lab's .af-primary.
    const start = el.querySelector<HTMLButtonElement>('[data-testid="pw-start"]')!;
    expect(start.disabled).toBe(true);
    const data = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'snapshot', content: 'start_agent:\n', issues: 0 };
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data })); });
    expect(start.disabled).toBe(true);
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: el.querySelector('iframe')!.contentWindow, data })); });
    await waitFor(() => expect(start.disabled).toBe(false));
    await openView(el, 'Tests');
    const tests = el.querySelector<HTMLElement>('[data-testid="studio-view-tests"]')!;
    await act(async () => { within(tests).getByRole('button', { name: 'Role-play' }).click(); });
    const lab = tests.querySelector<HTMLElement>('[data-testid="agentforce-lab"]')!;
    const picker = within(lab).getByLabelText('Shared scenario');
    await within(picker).findByRole('option', { name: 'Missing details · revision 1' });
    await act(async () => fireEvent.change(picker, { target: { value: starterScenarios()[1].id } }));
    const persona = lab.querySelector<HTMLTextAreaElement>('textarea')!.value;
    expect(persona).toContain('distracted');
    await openView(el, 'Preview');
    expect(tests.style.display).toBe('none');
    await openView(el, 'Tests');
    expect(tests.style.display).toBe('');
    expect(lab.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(persona);
    expect(el.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('opens related tabs from the explorer and graph, preserves the iframe, and removes deleted draft actions', async () => {
    const el = await mount();
    const frame = el.querySelector('iframe')!;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const actions = parseAgentScriptSource(ACTION_AGENT, 'agentforce').actions;
    const dispatch = async (data: Record<string, unknown>) => act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame.contentWindow, data: { source: PLAYGROUND_BRIDGE_SOURCE, ...data } })); });
    await dispatch({ type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    await openTool(el, 'Actions');
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Inspect lookup in start_agent.orders"]')!.click());
    expect(frame.style.display).toBe('');
    expect(el.querySelector('[aria-label="Action lookup"]')).toBeTruthy();
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.af-action-nav button')].find(b => b.textContent?.startsWith('Used by'))!.click());
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Go to action definition'))!.click());
    expect(frame.style.display).toBe(''); expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'revealLine', line: actions[0].line }), location.origin);
    await dispatch({ type: 'openAction', id: actions[1].id });
    expect(el.querySelector('[aria-label="Action refund"]')).toBeTruthy();
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Close refund"]')!.click());
    expect(frame.style.display).toBe('');
    await dispatch({ type: 'openAction', id: actions[0].id });
    await dispatch({ type: 'snapshot', content: '', issues: 0, actions: [] });
    expect(el.querySelector('[data-testid="agent-action-panel"]')).toBeNull();
    expect(el.querySelector('iframe')).toBe(frame);
    expect(el.querySelector('.af-related-tabs')).toBeNull();
  });

  it('B: Inspect <action> in the Graph view opens it over an open dependency tab', async () => {
    const el = await mount('', 'proj-1', false);
    await openAgentFile(el);
    const frame = el.querySelector<HTMLIFrameElement>('iframe[title="Agentforce playground"]')!;
    const actions = parseAgentScriptSource(ACTION_AGENT, 'agentforce').actions;
    const refund = actions.find(action => action.name === 'refund')!;
    const dispatch = async (source: Window | null, data: Record<string, unknown>) => act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source, data: { source: PLAYGROUND_BRIDGE_SOURCE, ...data } })); });
    await dispatch(frame.contentWindow, { type: 'snapshot', content: ACTION_AGENT, issues: 0, actions });
    await openTool(el, 'Actions');
    await dispatch(frame.contentWindow, { type: 'openAction', id: refund.id });
    await dispatch(frame.contentWindow, { type: 'openAction', id: actions.find(action => action.name === 'lookup')!.id });
    const pressed = () => [...el.querySelectorAll('.af-related-tabs [aria-pressed="true"]')].map(b => b.textContent);
    expect(pressed()).toEqual(['lookup']);
    await openView(el, 'Graph');
    const graph = el.querySelector<HTMLIFrameElement>('iframe[title="AgentScript graph"]')!;
    vi.spyOn(graph.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    await dispatch(graph.contentWindow, { type: 'ready' });
    await dispatch(graph.contentWindow, { type: 'openAction', id: refund.id });
    expect(pressed()).toEqual(['refund']);
  });

  it('A: opens an agent requested before the editor frame is ready, over the initial and restored agent', async () => {
    let release: (() => void) | undefined;
    rpc.mockImplementation(async (pluginId: string, method: string, args?: { path?: string; projectId?: string }) => {
      if (method === 'agentFiles.list') return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }, { apiName: 'Help', path: 'force-app/bots/Help.agent', lines: 4 }] };
      if (method === 'agentFiles.read' && args?.path === 'force-app/bots/Help.agent' && !release) await new Promise<void>(resolve => { release = resolve; });
      return baseRpc(pluginId, method, args);
    });
    const el = await mount('force-app/bots/QC.agent');
    const post = vi.spyOn(el.querySelector('iframe')!.contentWindow!, 'postMessage');
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="sf-explorer-all-agents"]')?.click(); });
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agent-script-file:force-app/bots/Help.agent"]')!.click(); });
    await message(el, { type: 'ready' });
    await act(async () => { release!(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const files = post.mock.calls.map(call => call[0] as { type: string; path?: string | null }).filter(row => row.type === 'setFile');
    expect(files.map(row => row.path)).toEqual(['force-app/bots/Help.agent']);
    expect(within(el).getByRole('tab', { name: /^Help\.agent/ })).toBeTruthy();
  });

  it('A: a click made while the frame loads wins over a queued open', async () => {
    rpc.mockImplementation(async (pluginId: string, method: string, args?: { path?: string; projectId?: string }) => {
      if (method === 'agentFiles.list') return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }, { apiName: 'Help', path: 'force-app/bots/Help.agent', lines: 4 }] };
      return baseRpc(pluginId, method, args);
    });
    const el = await mount('', 'proj-1', false);
    const post = vi.spyOn(el.querySelector('iframe')!.contentWindow!, 'postMessage');
    queueAgentScriptOpen('proj-1', 'force-app/bots/QC.agent');
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agent-script-file:force-app/bots/Help.agent"]')!.click(); });
    await message(el, { type: 'ready' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(post.mock.calls.map(call => call[0] as { type: string; path?: string | null }).filter(row => row.type === 'setFile').map(row => row.path).at(-1)).toBe('force-app/bots/Help.agent');
    expect(within(el).queryByRole('tab', { name: /^QC\.agent/ })).toBeNull();
  });

  it('A: a view tab picked while the frame loads stays selected when the agent is sent to the frame', async () => {
    rpc.mockImplementation(async (pluginId: string, method: string, args?: { path?: string; projectId?: string }) => {
      if (method === 'agentFiles.list') return { ok: true, files: [{ apiName: 'Help', path: 'force-app/bots/Help.agent', lines: 4 }] };
      return baseRpc(pluginId, method, args);
    });
    const el = await mount('', 'proj-1', false);
    const post = vi.spyOn(el.querySelector('iframe')!.contentWindow!, 'postMessage');
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agent-script-file:force-app/bots/Help.agent"]')!.click(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await openView(el, 'Tests');
    const selected = () => within(el).getByRole('tablist', { name: 'Open files' }).querySelector('[role="tab"][aria-selected="true"]')?.textContent;
    expect(selected()).toMatch(/^Tests/);
    await message(el, { type: 'ready' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(post.mock.calls.map(call => call[0] as { type: string; path?: string | null }).filter(row => row.type === 'setFile').map(row => row.path).at(-1)).toBe('force-app/bots/Help.agent');
    expect(selected()).toMatch(/^Tests/);
  });

  it('A: with no request before ready, the initial agent opens', async () => {
    const el = await mount('force-app/bots/QC.agent');
    const post = vi.spyOn(el.querySelector('iframe')!.contentWindow!, 'postMessage');
    await message(el, { type: 'ready' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(post.mock.calls.map(call => call[0] as { type: string; path?: string | null }).filter(row => row.type === 'setFile').map(row => row.path)).toEqual(['force-app/bots/QC.agent']);
  });

  it('ignores playground messages from other origins', async () => {
    await mount();
    const calls = rpc.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://evil.example',
          data: { source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' }
        })
      );
    });
    expect(rpc.mock.calls.length).toBe(calls);
  });
  async function message(el: HTMLElement, data: object) {
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: el.querySelector('iframe')!.contentWindow, data: { source: PLAYGROUND_BRIDGE_SOURCE, ...data } })); });
  }
  it('saves recovered files against their original disk revision and retains a failed draft', async () => {
    const key = 'proj-1:file:force-app/bots/QC.agent';
    writeAgentDraft({ key, content: 'unsaved recovered', baseSha: 'original', dialect: 'agentforce' });
    const el = await mount('force-app/bots/QC.agent');
    await message(el, { type: 'ready' });
    rpc.mockImplementation(async (id, method, args) => method === 'agentFiles.write' ? { ok: false, error: 'Changed on disk' } : baseRpc(id, method, args));
    await message(el, { type: 'persist', path: 'force-app/bots/QC.agent', content: 'unsaved recovered', draftKey: key });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.write', expect.objectContaining({ expectedSha256: 'original' }));
    expect(el.textContent).toContain('Changed on disk');
    expect(readAgentDraft(key)?.content).toBe('unsaved recovered');
  });

  it('saves a copy of the open agent and keeps the Save as dialog open on collision', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await message(el, { type: 'ready' });
    await act(async () => { (el.querySelector('[aria-label="More save options"]') as HTMLButtonElement).click(); });
    await act(async () => { (el.querySelector('[role="menuitem"]') as HTMLButtonElement).click(); });
    expect(el.querySelector('dialog[open]')).toBeTruthy();
    const post = vi.spyOn(el.querySelector('iframe')!.contentWindow!, 'postMessage');
    await act(async () => { fireEvent.change(el.querySelector('dialog input')!, { target: { value: 'Copy.agent' } }); fireEvent.submit(el.querySelector('dialog form')!); });
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'flushSave', path: 'Copy.agent', create: true }), window.location.origin);
    rpc.mockImplementation(async (id, method, args) => method === 'agentFiles.create' ? { ok: false, error: 'Already exists' } : baseRpc(id, method, args));
    await message(el, { type: 'persist', path: 'Copy.agent', content: 'draft', create: true });
    expect(el.querySelector('dialog [role=alert]')?.textContent).toContain('Already exists');
    rpc.mockImplementation(async (id, method, args) => method === 'agentFiles.create' ? { ok: true, file: { path: 'Copy.agent', sha256: 'new-sha' } } : baseRpc(id, method, args));
    await message(el, { type: 'persist', path: 'Copy.agent', content: 'draft', create: true });
    expect(el.querySelector('dialog')).toBeNull();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.create', expect.objectContaining({ path: 'Copy.agent', content: 'draft', projectId: 'proj-1' }));
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', expect.objectContaining({ path: 'Copy.agent' }));
  });

  it('warns when local recovery is unavailable and rejects stale editor messages', async () => {
    const el = await mount('force-app/bots/QC.agent');
    await message(el, { type: 'ready' });
    await message(el, { type: 'dirty', dirty: true, draftKey: 'old-project:file:Other.agent', persisted: false });
    expect(el.querySelector('[role=alert]')).toBeNull();
    await message(el, { type: 'dirty', dirty: true, draftKey: 'proj-1:file:force-app/bots/QC.agent', persisted: false, baseSha: 'abc' });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Local recovery is unavailable');
  });

  it('preserves typing during a save and advances only the saved base revision', async () => {
    const key = 'proj-1:file:force-app/bots/QC.agent';
    const el = await mount('force-app/bots/QC.agent');
    await message(el, { type: 'ready' });
    writeAgentDraft({ key, content: 'submitted', baseSha: 'abc', dialect: 'agentforce' });
    let finish!: (result: any) => void;
    rpc.mockImplementation((id, method, args) => method === 'agentFiles.write' ? new Promise(resolve => { finish = resolve; }) : baseRpc(id, method, args));
    await message(el, { type: 'persist', path: 'force-app/bots/QC.agent', content: 'submitted', draftKey: key });
    await message(el, { type: 'persist', path: 'force-app/bots/QC.agent', content: 'duplicate', draftKey: key });
    expect(rpc.mock.calls.filter(([, method]) => method === 'agentFiles.write')).toHaveLength(1);
    writeAgentDraft({ key, content: 'newer typing', baseSha: 'abc', dialect: 'agentforce' });
    await act(async () => finish({ ok: true, file: { path: 'force-app/bots/QC.agent', sha256: 'saved-revision' } }));
    expect(readAgentDraft(key)).toMatchObject({ content: 'newer typing', baseSha: 'saved-revision' });
    expect(el.querySelector('[data-testid="salesforce-agent-script-save"]')?.textContent).toBe('Save');
  });

  it('keeps recovery data when saving throws and allows cancelling Save as', async () => {
    const key = 'proj-1:file:force-app/bots/QC.agent';
    const el = await mount('force-app/bots/QC.agent');
    await message(el, { type: 'ready' });
    writeAgentDraft({ key, content: 'recover me', baseSha: 'abc', dialect: 'agentforce' });
    rpc.mockImplementation((id, method, args) => method === 'agentFiles.write' ? Promise.reject(Error('Disk unavailable')) : baseRpc(id, method, args));
    await message(el, { type: 'persist', path: 'force-app/bots/QC.agent', content: 'recover me', draftKey: key });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Disk unavailable');
    expect(readAgentDraft(key)?.content).toBe('recover me');
    await act(async () => { (el.querySelector('[aria-label="More save options"]') as HTMLButtonElement).click(); });
    await act(async () => { (el.querySelector('[role="menuitem"]') as HTMLButtonElement).click(); });
    await act(async () => { el.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); });
    expect(el.querySelector('dialog')).toBeNull();
  });

});
