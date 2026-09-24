/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { fireEvent, within } from '@testing-library/react';
import { readAgentDraft, writeAgentDraft } from './agent-script-drafts.js';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentScriptPanel } from './AgentScriptPanel.js';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';
import { queueAgentScriptOpen } from './agent-script-open.js';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { ACTION_AGENT } from '../action-fixtures.js';

const rpc = vi.fn(async (_pluginId: string, method: string, args?: { path?: string; projectId?: string }) => {
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

  async function mount(subPath = '', projectId = 'proj-1', orgPicker = true) {
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
      root.render(createElement(AgentScriptPanel, { pluginId: 'salesforce', subPath, projectId, orgPicker }));
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
    expect(el.querySelector('[data-testid="salesforce-agent-script-save"]')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.list', { projectId: 'proj-1' });
    expect(rpc.mock.calls.some((call) => call[0] === 'salesforce' && call[1] === 'org')).toBe(true);
    expect(el.querySelector('[data-testid="salesforce-playground-org"]')?.textContent).toBe('dev (sandbox)');
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
    await act(async () => {
      const example = [...el.querySelectorAll('.sf-as-tree-btn')].find((button) =>
        button.textContent?.includes('Support concierge')
      ) as HTMLButtonElement | undefined;
      example?.click();
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: el.querySelector("iframe")!.contentWindow,
          data: { source: PLAYGROUND_BRIDGE_SOURCE, type: 'dirty', dirty: true }
        })
      );
    });
    expect(save.textContent).toBe('Example');
    await act(async () => {
      save.click();
    });
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

  async function openTool(el: HTMLElement, name: string) {
    const tab = within(el).queryByRole('tab', { name, exact: true });
    if (tab) { await act(async () => { tab.click(); }); return; }
    await act(async () => { within(el).getByRole('button', { name: 'Add side panel tab' }).click(); });
    await act(async () => { within(el).getByRole('button', { name: new RegExp(`^${name}`) }).click(); });
  }

  it('opens a graph beside the same editor and can hide and restore the panel', async () => {
    const el = await mount('', 'proj-1', false);
    expect(within(el).queryByRole('combobox', { name: 'Salesforce org' })).toBeNull();
    expect(el.querySelector('.sf-as-header')).toBeNull();
    expect(el.querySelector('.sf-as-stage .af-document-bar')).toBeTruthy();
    const editor = el.querySelector('iframe')!;
    await openTool(el, 'Graph view');
    expect(within(el).getByRole('tab', { name: 'Graph view' }).getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('iframe')).toBe(editor);
    expect(editor.style.display).not.toBe('none');
    expect(el.querySelector('iframe[title="AgentScript graph"]')).toBeTruthy();
    await act(async () => within(el).getAllByRole('button', { name: 'Hide side panel' })[0].click());
    expect(el.querySelector<HTMLElement>('.af-tools')!.hidden).toBe(true);
    await act(async () => within(el).getByRole('button', { name: 'Show side panel' }).click());
    expect(el.querySelector<HTMLElement>('.af-tools')!.hidden).toBe(false);
    expect(el.querySelector('iframe')).toBe(editor);
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
    await openTool(el, 'Preview');
    const start = el.querySelector<HTMLButtonElement>('.af-primary')!;
    expect(start.disabled).toBe(true);
    const data = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'snapshot', content: 'start_agent:\n', issues: 0 };
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data })); });
    expect(start.disabled).toBe(true);
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: el.querySelector('iframe')!.contentWindow, data })); });
    expect(start.disabled).toBe(false);
    await openTool(el, 'Tests');
    const lab = within(el).getByRole('tabpanel', { name: 'Tests' }).querySelector<HTMLElement>('[data-testid="agentforce-lab"]')!;
    await act(async () => { [...lab.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Missing details')!.click(); });
    const persona = lab.querySelector<HTMLTextAreaElement>('textarea')!.value;
    expect(persona).toContain('distracted');
    await openTool(el, 'File explorer');
    expect(lab.closest<HTMLElement>('[role=tabpanel]')!.hidden).toBe(true);
    await openTool(el, 'Tests');
    expect(lab.closest<HTMLElement>('[role=tabpanel]')!.hidden).toBe(false);
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
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>('.af-action-nav button')].find(b => b.textContent === 'Used by')!.click());
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

  it('creates an example copy and keeps the Save as dialog open on collision', async () => {
    const el = await mount();
    await message(el, { type: 'ready' });
    await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent === 'Save as…')!.click(); });
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
    await act(async () => { [...el.querySelectorAll('button')].find(b => b.textContent === 'Save as…')!.click(); });
    await act(async () => { el.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); });
    expect(el.querySelector('dialog')).toBeNull();
  });

});
