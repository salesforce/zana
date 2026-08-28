/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentScriptPanel } from './AgentScriptPanel.js';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';

const rpc = vi.fn(async (_pluginId: string, method: string, args?: { path?: string }) => {
  if (method === 'status') {
    return { dxProject: true, agentScriptDialect: 'agentforce', projectRoot: '/proj' };
  }
  if (method === 'agentFiles.list') {
    return { ok: true, files: [{ apiName: 'Bot', path: 'force-app/Bot.agent', lines: 4 }] };
  }
  if (method === 'agentFiles.read') {
    return {
      ok: true,
      file: { path: args?.path ?? 'force-app/Bot.agent', content: 'start_agent:\n', sha256: 'abc' }
    };
  }
  if (method === 'agentFiles.write') {
    return { ok: true, file: { path: args?.path ?? 'force-app/Bot.agent', sha256: 'def' } };
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
      useSettings: () => ({ values: { agentScriptDialect: 'agentforce' }, isLoading: false })
    };
  });

  afterEach(() => {
    for (const node of nodes.splice(0)) node.unmount();
    delete (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__;
    delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
  });

  async function mount(subPath = '') {
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
      root.render(createElement(AgentScriptPanel, { pluginId: 'salesforce', subPath }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    return el;
  }

  it('renders the workbench chrome and playground iframe', async () => {
    const el = await mount();
    expect(el.querySelector('[data-testid="salesforce-agent-script-panel"]')).toBeTruthy();
    expect(el.querySelector('iframe')?.getAttribute('title')).toBe('Agent Script playground');
    expect((el.querySelector('[aria-label="Agent Script dialect"]') as HTMLSelectElement | null)?.value).toBe(
      'agentforce'
    );
    expect(el.querySelector('[aria-label="Agent Script file"]')).toBeTruthy();
  });

  it('opens a scanned file after the playground is ready and persists on request', async () => {
    const el = await mount('force-app/Bot.agent');
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { source: PLAYGROUND_BRIDGE_SOURCE, type: 'ready' }
        })
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', { path: 'force-app/Bot.agent' });
    const save = el.querySelector('button') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: {
            source: PLAYGROUND_BRIDGE_SOURCE,
            type: 'persist',
            path: 'force-app/Bot.agent',
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
      expect.objectContaining({ path: 'force-app/Bot.agent', content: 'updated' })
    );
    await act(async () => {
      const dialect = el.querySelector('[aria-label="Agent Script dialect"]') as HTMLSelectElement;
      dialect.value = 'agentscript';
      dialect.dispatchEvent(new Event('change', { bubbles: true }));
      const file = el.querySelector('[aria-label="Agent Script file"]') as HTMLSelectElement;
      file.value = 'example:minimal';
      file.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { source: PLAYGROUND_BRIDGE_SOURCE, type: 'dirty', dirty: true }
        })
      );
    });
    expect(save.textContent).toBe('Save');
    await act(async () => {
      save.click();
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          data: { source: PLAYGROUND_BRIDGE_SOURCE, type: 'requestOpen', path: 'force-app/Bot.agent' }
        })
      );
    });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentFiles.read', { path: 'force-app/Bot.agent' });
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
