/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SoqlExplorerPanel } from './soql/SoqlExplorerPanel.js';

const rpc = vi.fn(async (_pluginId: string, method: string, args?: Record<string, unknown>) => {
  if (method === 'soql.describeGlobal') {
    return {
      ok: true,
      org: { alias: 'dev', username: 'dev@example.com', orgId: '00D', instanceUrl: 'https://example', apiVersion: '62.0', kind: 'sandbox', isDefault: true },
      catalogs: {
        standard: [{ name: 'Account', label: 'Account', keyPrefix: '001', queryable: true, custom: false, source: 'standard' }],
        tooling: [{ name: 'BotVersion', label: 'Bot Version', keyPrefix: '0j5', queryable: true, custom: false, source: 'tooling' }]
      }
    };
  }
  if (method === 'soql.limits') {
    return { ok: true, dailyApiRequests: { max: 15000, remaining: 14900 } };
  }
  if (method === 'soql.history.list') {
    return { ok: true, recent: [], saved: [] };
  }
  if (method === 'orgs') {
    return {
      ok: true,
      selectedAlias: 'dev',
      orgs: [
        {
          alias: 'dev',
          username: 'dev@example.com',
          kind: 'sandbox',
          isDefault: true,
          orgId: '00D',
          instanceUrl: 'https://example',
          connectedStatus: 'Connected'
        }
      ]
    };
  }
  if (method === 'soql.describeSObject') {
    return {
      ok: true,
      describe: {
        name: args?.sobject ?? 'Account',
        label: 'Account',
        keyPrefix: '001',
        queryable: true,
        source: 'standard',
        fields: [{ name: 'Id', label: 'Id', type: 'id', relationshipName: null, referenceTo: [], nillable: false, updateable: false, calculated: false, sortable: true, filterable: true, length: 18 }],
        childRelationships: []
      }
    };
  }
  if (method === 'soql.query') {
    return {
      ok: true,
      soql: args?.soql,
      sobjectName: 'Account',
      totalSize: 1,
      done: true,
      records: [{ Id: '001xx', Name: 'Acme' }]
    };
  }
  if (method === 'soql.abort') return { ok: true, aborted: true };
  return { ok: false, error: `unexpected ${method}` };
});

describe('SoqlExplorerPanel', () => {
  const nodes: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    rpc.mockClear();
    (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__ = {
      callRpc: rpc,
      setSettings: async () => undefined
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useSettings: () => ({ values: { defaultOrg: 'dev' }, isLoading: false })
    };
  });

  afterEach(() => {
    for (const node of nodes.splice(0)) node.unmount();
    delete (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__;
    delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
  });

  async function mount() {
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
      root.render(createElement(SoqlExplorerPanel, { pluginId: 'salesforce', projectId: 'proj-1' }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return el;
  }

  it('renders the explorer chrome and runs a query', async () => {
    const el = await mount();
    expect(el.querySelector('[data-testid="soql-explorer"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="soql-editor"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="soql-run"]')).toBeTruthy();
    expect(el.textContent).toContain('dev (sandbox)');
    await act(async () => {
      const sobject = el.querySelector('[data-testid="soql-sobject:Account"]') as HTMLButtonElement;
      sobject?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      (el.querySelector('[data-testid="soql-run"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'soql.query', expect.objectContaining({ soql: expect.any(String) }));
    expect(el.querySelector('[data-testid="soql-results"]')?.textContent).toContain('Acme');
    await act(async () => {
      (el.querySelector('[data-testid="soql-history-toggle"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-testid="soql-history"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="soql-example:bot-version"]')).toBeTruthy();
  });

  it('shows an empty-org error when describeGlobal fails', async () => {
    rpc.mockImplementation(async (_pluginId, method) => {
      if (method === 'soql.describeGlobal') return { ok: false, code: 'no_org', error: 'No target org.' };
      return { ok: false };
    });
    const el = await mount();
    expect(el.textContent).toContain('No target org.');
    expect((el.querySelector('[data-testid="soql-run"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
