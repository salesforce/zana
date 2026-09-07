/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { OrgPicker } from './OrgPicker.js';
import { SalesforceProjectTab } from './SalesforceProjectTab.js';
import app from '../../app.tsx';

const orgs = [
  {
    alias: 'dev',
    username: 'dev@example.com',
    kind: 'sandbox',
    isDefault: true,
    orgId: '00D1',
    instanceUrl: 'https://example',
    connectedStatus: 'Connected'
  },
  {
    alias: 'prod',
    username: 'prod@example.com',
    kind: 'production',
    isDefault: false,
    orgId: '00D2',
    instanceUrl: 'https://prod',
    connectedStatus: 'Connected'
  }
];

const rpc = vi.fn(async (_pluginId: string, method: string) => {
  if (method === 'orgs') return { ok: true, orgs, selectedAlias: 'dev' };
  if (method === 'status') return { defaultOrg: 'dev', selectedAlias: 'dev', dxProject: true, orgs };
  if (method === 'doctor') return { cliOk: true, org: { alias: 'dev', kind: 'sandbox' }, agentBundleCount: 1 };
  return { ok: false, error: `unexpected ${method}` };
});
const setSettings = vi.fn(async () => undefined);

describe('OrgPicker and Salesforce project tab', () => {
  const nodes: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    rpc.mockClear();
    setSettings.mockClear();
    (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__ = {
      callRpc: rpc,
      setSettings
    };
    (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__ = {
      useSettings: () => ({ values: { defaultOrg: 'dev' }, isLoading: false }),
      useZccContext: () => ({ projectId: 'proj-1', threadId: 'thr-1' }),
      useZccNavigate: () => ({
        toProject: vi.fn(),
        toThread: vi.fn(),
        toPluginPanel: vi.fn(),
        toCompose: vi.fn(),
        openThreadPanel: vi.fn()
      })
    };
  });

  afterEach(() => {
    for (const node of nodes.splice(0)) node.unmount();
    delete (globalThis as { __ZCC_PLUGIN_HOST__?: unknown }).__ZCC_PLUGIN_HOST__;
    delete (globalThis as { __ZCC_PLUGIN_RUNTIME__?: unknown }).__ZCC_PLUGIN_RUNTIME__;
  });

  async function mount(node: ReturnType<typeof createElement>) {
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
      root.render(node);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    return el;
  }

  it('lists CLI orgs and persists the shared defaultOrg setting', async () => {
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce' }));
    expect(el.querySelector('[data-testid="salesforce-org-list"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-org:dev"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-org:prod"]')).toBeTruthy();
    expect((el.querySelector('[data-testid="salesforce-org:dev"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe(
      'true'
    );
    await act(async () => {
      (el.querySelector('[data-testid="salesforce-org:prod"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(setSettings).toHaveBeenCalledWith('salesforce', { defaultOrg: 'prod' });
  });

  it('shows a compact shared picker', async () => {
    const onSelect = vi.fn();
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce', compact: true, onSelect }));
    const select = el.querySelector('[data-testid="salesforce-org-picker"]') as HTMLSelectElement;
    expect(select.value).toBe('dev');
    expect(select.options).toHaveLength(2);
    await act(async () => {
      select.value = 'prod';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(setSettings).toHaveBeenCalledWith('salesforce', { defaultOrg: 'prod' });
    expect(onSelect).toHaveBeenCalledWith('prod');
  });

  it('lists CLI orgs from the plugin settings section', async () => {
    const Section = collectTestPluginApp(app, 'salesforce').settingsSections[0]?.component;
    expect(Section).toBeTruthy();
    const el = await mount(createElement(Section!, { pluginId: 'salesforce' }));
    expect(el.querySelector('[data-testid="salesforce-org-list"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-org:prod"]')).toBeTruthy();
    expect(el.textContent).toContain('CLI-connected orgs');
  });

  it('renders CLI orgs on the Salesforce project tab', async () => {
    const el = await mount(createElement(SalesforceProjectTab, { pluginId: 'salesforce', projectId: 'proj-1' }));
    expect(el.textContent).toContain('CLI-connected orgs');
    expect(el.querySelector('[data-testid="salesforce-org:prod"]')).toBeTruthy();
    expect(el.textContent).toContain('Open SOQL');
  });
});
