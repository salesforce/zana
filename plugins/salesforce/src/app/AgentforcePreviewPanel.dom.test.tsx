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
  if (method === 'agentPreview.start') {
    return { ok: true, data: { sessionId: 'sess-1' } };
  }
  if (method === 'agentPreview.send') {
    return { ok: true, data: { sessionId: 'sess-1', response: `echo:${args?.utterance}` } };
  }
  if (method === 'agentPreview.end') {
    return { ok: true };
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

describe('AgentforcePreviewPanel', () => {
  const nodes: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    rpc.mockClear();
    (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__ = {
      callRpc: rpc,
      setSettings: async () => undefined
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useZccContext: () => ({ projectId: 'proj-1', threadId: 'thr-1' }),
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
    });
    return el;
  }

  it('starts simulate preview, sends an utterance, and ends the session', async () => {
    const el = await mount();
    expect(el.querySelector('[data-testid="salesforce-agentforce-preview"]')).toBeTruthy();
    expect((el.querySelector('[aria-label="Agentforce preview mode"]') as HTMLSelectElement).value).toBe('simulate');
    await act(async () => {
      (el.querySelector('[data-testid="salesforce-agentforce-preview-start"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith(
      'salesforce',
      'agentPreview.start',
      expect.objectContaining({
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
      'agentPreview.send',
      expect.objectContaining({ sessionId: 'sess-1', utterance: 'hello' })
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
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentPreview.end', expect.objectContaining({ sessionId: 'sess-1' }));
  });

  it('starts live preview after switching mode', async () => {
    const el = await mount();
    const mode = el.querySelector('[aria-label="Agentforce preview mode"]') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(mode, 'live');
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(el.textContent).toContain('Live Test runs real org actions');
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
    const el = await mount({ apiName: 'QC' });
    expect(el.querySelector('.sf-as-crumb-seg')?.textContent).toBe('QC');
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
      if (method === 'agentPreview.start') {
        return { ok: false, error: 'no org' };
      }
      return { ok: false, error: `unexpected ${method}` };
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
});
