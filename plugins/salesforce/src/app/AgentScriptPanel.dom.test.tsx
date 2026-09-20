/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
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

describe('AgentScriptPanel', () => {
  const nodes: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    rpc.mockClear();
    (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__ = {
      callRpc: rpc,
      getSettings: async () => ({ values: { agentScriptDialect: 'agentforce' } }),
      setSettings: async () => undefined
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useSettings: () => ({ values: { agentScriptDialect: 'agentforce', defaultOrg: 'dev' }, isLoading: false })
    };
  });

  afterEach(() => {
    for (const node of nodes.splice(0)) node.unmount();
    delete (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__;
    delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
  });

  async function mount(subPath = '', projectId = 'proj-1') {
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
      root.render(createElement(AgentScriptPanel, { pluginId: 'salesforce', subPath, projectId }));
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
    expect((el.querySelector('[aria-label="Agentforce dialect"]') as HTMLSelectElement | null)?.value).toBe(
      'agentforce'
    );
    expect(el.querySelector('[aria-label="Agentforce file"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-agent-script-explorer"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-agent-script-file:force-app/bots/QC.agent"]')).toBeTruthy();
    expect(el.querySelector('select[aria-label="Agent Script file"]')).toBeNull();
    expect(el.querySelector('[aria-label="Agentforce view"]')?.textContent).toContain('Script');
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
      const dialect = el.querySelector('[aria-label="Agentforce dialect"]') as HTMLSelectElement;
      dialect.value = 'agentscript';
      dialect.dispatchEvent(new Event('change', { bubbles: true }));
      const example = [...el.querySelectorAll('.sf-as-tree-btn')].find((button) =>
        button.textContent?.includes('Minimal')
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
    expect(save.textContent).toBe('Save');
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

  it('switches Script / Graph / Split views', async () => {
    const el = await mount();
    const graph = [...el.querySelectorAll('.sf-as-tab')].find((button) => button.textContent === 'Graph') as HTMLButtonElement;
    expect(graph).toBeTruthy();
    await act(async () => {
      graph.click();
    });
    expect(graph.getAttribute('aria-pressed')).toBe('true');
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

  it('accepts draft snapshots only from its iframe and preserves labs between workflow views', async () => {
    const el = await mount();
    const workflow = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('.af-workflows button')].find(button => button.textContent?.endsWith(name))!;
    await act(async () => workflow('Rehearse').click());
    const start = el.querySelector<HTMLButtonElement>('.af-primary')!;
    expect(start.disabled).toBe(true);
    const data = { source: PLAYGROUND_BRIDGE_SOURCE, type: 'snapshot', content: 'start_agent:\n', issues: 0 };
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, data })); });
    expect(start.disabled).toBe(true);
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: el.querySelector('iframe')!.contentWindow, data })); });
    expect(start.disabled).toBe(false);
    await act(async () => workflow('Test').click());
    const lab = el.querySelector<HTMLElement>('[data-testid="agentforce-lab"]:not([hidden])')!;
    await act(async () => { [...lab.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Missing details')!.click(); });
    const persona = lab.querySelector<HTMLTextAreaElement>('textarea')!.value;
    expect(persona).toContain('distracted');
    await act(async () => workflow('Build').click());
    expect([...el.querySelectorAll<HTMLElement>('[data-testid="agentforce-lab"]')].every(node => node.hidden)).toBe(true);
    await act(async () => workflow('Test').click());
    expect(lab.hidden).toBe(false);
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
    await act(async () => el.querySelector<HTMLButtonElement>('[aria-label="Inspect lookup in start_agent.orders"]')!.click());
    expect(frame.style.display).toBe('none');
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
});
