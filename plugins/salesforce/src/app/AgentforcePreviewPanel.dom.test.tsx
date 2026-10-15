/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentforcePreviewPanel } from './AgentforcePreviewPanel.js';

const rpc = vi.fn(async (_pluginId: string, method: string, args?: Record<string, unknown>) => {
  if (method === 'agentFiles.list') {
    return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }] };
  }
  if (method === 'agentFiles.read') return { ok: true, file: { content: 'config:\n  agent_type: AgentforceEmployeeAgent' } };
  if (method === 'agentLab.start') return { ok: true, data: { id: 'sess-1', turns: [{ role: 'agent', text: 'Welcome from your agent' }] } };
  if (method === 'agentLab.send') return { ok: true, data: { id: 'sess-1', turns: [{ role: 'agent', text: `echo:${args?.text}` }] } };
  if (method === 'agentLab.end') return { ok: true, data: { id: 'sess-1', turns: [] } };
  if (method === 'agentPreview.start') {
    return { ok: true, data: { sessionId: 'sess-1' } };
  }
  if (method === 'agentPreview.send') {
    return { ok: true, data: { sessionId: 'sess-1', response: `echo:${args?.utterance}` } };
  }
  if (method === 'agentPreview.end') {
    return { ok: true };
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
  return { ok: false, error: `unexpected ${method}` };
});

const baseRpc = rpc.getMockImplementation()!;
const navigate = { openThreadPanel: vi.fn(() => true) };
const run = {
  id: 'run-1', engine: 'preview', orgAlias: 'dev', sourceHash: 'h', model: 'm', closed: true, failed: false, path: 'force-app/bots/QC.agent',
  turns: [{ role: 'agent', text: 'Welcome', planId: 'p0' }, { role: 'user', text: 'Where is my order?' }, { role: 'agent', text: 'Order 42 ships today.', planId: 'p1', latencyMs: 1200 }]
};
const trace = { runId: 'run-1', turn: 2, planId: 'p1', available: true, steps: [{ kind: 'action', label: 'FindOrder', source: { path: 'force-app/bots/QC.agent', line: 7 } }] };
describe('AgentforcePreviewPanel', () => {
  const nodes: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    rpc.mockClear();
    rpc.mockImplementation(baseRpc);
    navigate.openThreadPanel.mockClear();
    (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__ = {
      callRpc: rpc,
      setSettings: async () => undefined
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useZccContext: () => ({ projectId: 'proj-1', threadId: 'thr-1' }),
      useZccNavigate: () => navigate,
      useSettings: () => ({ values: { defaultOrg: 'dev' }, isLoading: false })
    };
  });

  afterEach(() => {
    for (const node of nodes.splice(0)) node.unmount();
    delete (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__;
    delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
  });

  async function mount(params: unknown = { path: 'force-app/bots/QC.agent' }) {
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
      root.render(
        createElement(AgentforcePreviewPanel, {
          pluginId: 'salesforce',
          threadId: 'thr-1',
          projectId: 'proj-1',
          params
        })
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return el;
  }

  it('starts simulate preview, sends an utterance, and ends the session', async () => {
    const el = await mount();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.list', { projectId: 'proj-1', purpose: 'preview' });
    expect(el.querySelector('[data-testid="salesforce-agentforce-preview"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-preview-org"]')?.textContent).toContain('dev');
    expect((el.querySelector('[aria-label="Agentforce preview mode"]') as HTMLSelectElement).value).toBe('simulate');
    await act(async () => {
      (el.querySelector('[data-testid="salesforce-agentforce-preview-start"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.textContent).toContain('Welcome from your agent');
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Agentforce preview file"]')!.disabled).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'salesforce',
      'agentLab.start',
      expect.objectContaining({
        engine: 'preview',
        source: 'config:\n  agent_type: AgentforceEmployeeAgent',
        threadId: 'thr-1',
        projectId: 'proj-1',
        path: 'force-app/bots/QC.agent',
        live: false
      })
    );
    const input = el.querySelector('[data-testid="salesforce-agentforce-preview-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'hello');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (el.querySelector('[data-testid="salesforce-agentforce-preview-send"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith(
      'salesforce',
      'agentLab.send',
      expect.objectContaining({ id: 'sess-1', text: 'hello' })
    );
    expect(el.querySelector('[data-testid="salesforce-agentforce-preview-transcript"]')?.textContent).toContain(
      'echo:hello'
    );
    await act(async () => {
      (el.querySelector('[data-testid="salesforce-agentforce-preview-end"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.end', expect.objectContaining({ id: 'sess-1' }));
  });

  it('starts live preview after switching mode', async () => {
    const el = await mount();
    const mode = el.querySelector('[aria-label="Agentforce preview mode"]') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(mode, 'live');
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(el.textContent).toContain('Live Test runs real actions on dev (sandbox)');
    await act(async () => {
      (el.querySelector('[data-testid="salesforce-agentforce-preview-start"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith(
      'salesforce',
      'agentPreview.start',
      expect.objectContaining({ live: true, threadId: 'thr-1' })
    );
  });

  it('searches agents by name and path, reports no matches, and starts the selected local file', async () => {
    rpc.mockImplementation(async (id, method, args) => method === 'agentFiles.list' ? { ok: true, files: [
      { apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 },
      { apiName: 'Orders', path: 'force-app/service/Orders.agent', lines: 5 }
    ] } : baseRpc(id, method, args));
    const el = await mount({ apiName: 'Published' });
    const picker = el.querySelector<HTMLButtonElement>('[aria-label="Agentforce preview file"]')!;
    expect(picker.textContent).toContain('Published');
    await act(async () => { picker.click(); });
    const search = document.querySelector<HTMLInputElement>('[aria-label="Search agents…"]')!;
    const type = async (text: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, text);
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await type('missing');
    expect(document.querySelector('[role="listbox"]')?.textContent).toContain('No matching agents');
    await type('service/');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    await act(async () => { document.querySelector<HTMLButtonElement>('[role="option"]')!.click(); });
    expect(picker.textContent).toContain('Orders');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agentforce-preview-start"]')!.click(); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', { projectId: 'proj-1', path: 'force-app/service/Orders.agent' });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.start', expect.objectContaining({ apiName: undefined, path: 'force-app/service/Orders.agent' }));
    expect(picker.disabled).toBe(true);
  });

  it('disables start without a target and reports file-list errors', async () => {
    rpc.mockImplementation(async (id, method, args) => method === 'agentFiles.list' ? { ok: true, files: [] } : baseRpc(id, method, args));
    const empty = await mount({});
    expect(empty.querySelector<HTMLButtonElement>('[data-testid="salesforce-agentforce-preview-start"]')!.disabled).toBe(true);
    rpc.mockImplementation(async (id, method, args) => {
      if (method === 'agentFiles.list') throw new Error('Files unavailable');
      return baseRpc(id, method, args);
    });
    const failed = await mount();
    expect(failed.querySelector('[data-testid="salesforce-agentforce-preview-error"]')?.textContent).toBe('Files unavailable');
  });

  it('keeps published previews on the CLI and reports a missing returned session', async () => {
    rpc.mockImplementation(async (id, method, args) => method === 'agentPreview.start' ? { ok: true } : baseRpc(id, method, args));
    const el = await mount({ apiName: 'Published' });
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agentforce-preview-start"]')!.click(); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentPreview.start', expect.objectContaining({ apiName: 'Published', path: undefined }));
    expect(el.querySelector('[data-testid="salesforce-agentforce-preview-error"]')?.textContent).toBe('The preview returned no session.');
  });

  it('surfaces start failures and labels a file by apiName', async () => {
    rpc.mockImplementation(async (_pluginId: string, method: string) => {
      if (method === 'agentFiles.list') {
        return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }] };
      }
      if (method === 'agentPreview.start') {
        throw new Error('rpc down');
      }
      return { ok: false, error: `unexpected ${method}` };
    });
    const el = await mount({ apiName: 'Published' });
    expect(el.querySelector('[aria-label="Agentforce preview file"]')?.textContent).toContain('Published');
    await act(async () => {
      (el.querySelector('[data-testid="salesforce-agentforce-preview-start"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.querySelector('[data-testid="salesforce-agentforce-preview-error"]')?.textContent).toBe('rpc down');
  });

  it('shows a preview error when start returns ok:false', async () => {
    rpc.mockImplementation(async (_pluginId: string, method: string) => {
      if (method === 'agentFiles.list') {
        return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }] };
      }
      if (method === 'agentLab.start') {
        return { ok: false, error: 'no org' };
      }
      return baseRpc(_pluginId, method);
    });
    const el = await mount();
    await act(async () => {
      (el.querySelector('[data-testid="salesforce-agentforce-preview-start"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.querySelector('[data-testid="salesforce-agentforce-preview-error"]')?.textContent).toBe('no org');
  });

  it('releases the pinned session on tab close, including a start that finishes after closing', async () => {
    const el = await mount();
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agentforce-preview-start"]')!.click(); });
    rpc.mockClear();
    await act(async () => { nodes.pop()!.unmount(); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.end', expect.objectContaining({ id: 'sess-1', projectId: 'proj-1', orgAlias: 'dev' }));
    const pending = await mount();
    let finish!: (value: any) => void;
    rpc.mockImplementation((id, method, args) => method === 'agentLab.start' ? new Promise(resolve => { finish = resolve; }) : baseRpc(id, method, args));
    await act(async () => { pending.querySelector<HTMLButtonElement>('[data-testid="salesforce-agentforce-preview-start"]')!.click(); });
    await act(async () => { nodes.pop()!.unmount(); });
    rpc.mockClear();
    await act(async () => { finish({ ok: true, data: { id: 'late', turns: [] } }); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.end', expect.objectContaining({ id: 'late', projectId: 'proj-1', orgAlias: 'dev' }));
  });

  it('does not end an explicitly ended session a second time', async () => {
    const el = await mount();
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agentforce-preview-start"]')!.click(); });
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agentforce-preview-end"]')!.click(); });
    rpc.mockClear();
    await act(async () => { nodes.pop()!.unmount(); });
    expect(rpc.mock.calls.some(([, method]) => method === 'agentLab.end')).toBe(false);
  });

  it('reopens a linked run read-only, traces the chosen turn and reveals its line', async () => {
    rpc.mockImplementation(async (id: string, method: string, args?: Record<string, unknown>) =>
      method === 'agentLab.get' ? { ok: true, data: run } : method === 'agentLab.trace' ? { ok: true, data: { ...trace, planId: args?.planId } } : baseRpc(id, method, args));
    const el = await mount({ runId: 'run-1', turn: '2' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.get', { projectId: 'proj-1', id: 'run-1' });
    const replay = el.querySelector('[data-testid="salesforce-preview-run"]')!;
    expect(replay.textContent).toContain('Simulate run');
    expect(replay.textContent).toContain('QC.agent');
    expect(replay.textContent).toContain('Ended');
    expect(el.querySelector('[data-testid="salesforce-agentforce-preview-transcript"]')).toBeNull();
    expect(el.querySelector('[aria-label="Turn 2"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentLab.trace', { projectId: 'proj-1', id: 'run-1', planId: 'p1', turn: 2, path: 'force-app/bots/QC.agent' });
    const step = [...el.querySelectorAll<HTMLButtonElement>('button.sf-trace-row')].find(b => b.textContent?.includes('FindOrder'))!;
    await act(async () => { step.click(); });
    expect(navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: 'playground', title: 'Playground', params: { path: 'force-app/bots/QC.agent', line: '7' }, threadId: 'thr-1' });
    // With the Studio in its own window, the step opens there instead.
    const base = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (id: string, method: string, args?: Record<string, unknown>) =>
      method === 'control.views' ? { ok: true, views: [{ id: 'studio', surface: 'workbench', window: 'plugin-view', commands: ['view.open'] }] }
        : method === 'control.command' ? { ok: true, commandId: 'c' }
          : method === 'control.result' ? { ok: true, state: 'completed' } : base(id, method, args));
    navigate.openThreadPanel.mockClear();
    await act(async () => { step.click(); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'control.command', expect.objectContaining({ viewId: 'studio', input: { view: 'agentforce', path: 'force-app/bots/QC.agent', line: 7 } }));
    expect(navigate.openThreadPanel).not.toHaveBeenCalled();
    rpc.mockImplementation(base);
    await act(async () => { el.querySelector<HTMLButtonElement>('[aria-label="Turn 1"]')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(rpc).toHaveBeenLastCalledWith('salesforce', 'agentLab.trace', expect.objectContaining({ planId: 'p0', turn: 1 }));
    await act(async () => { [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Close run')!.click(); });
    expect(el.querySelector('[data-testid="salesforce-preview-run"]')).toBeNull();
    expect(el.querySelector('[data-testid="salesforce-agentforce-preview-transcript"]')).toBeTruthy();
  });

  it('explains an expired run and starting a new preview drops the replay', async () => {
    rpc.mockImplementation(async (id: string, method: string, args?: Record<string, unknown>) =>
      method === 'agentLab.get' ? { ok: false, error: 'This run has expired or belongs to another project. Start a new run.' } : baseRpc(id, method, args));
    const el = await mount({ runId: 'gone' });
    await act(async () => { await Promise.resolve(); });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('expired');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('30 idle minutes');
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agentforce-preview-start"]')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(el.querySelector('[data-testid="salesforce-preview-run"]')).toBeNull();
    expect(el.querySelector('[data-testid="salesforce-agentforce-preview-transcript"]')?.textContent).toContain('Simulate preview started.');
  });
});
