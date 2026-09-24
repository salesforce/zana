/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent } from '@testing-library/react';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';
import { OrgPicker } from './OrgPicker.js';
import { SalesforceOrgsPanel } from './SalesforceOrgsPanel.js';
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
    // happy-dom does not implement the native modal top layer; Electron tests
    // below cover inertness, focus containment, and Escape in the real browser.
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function () { this.setAttribute('open', ''); });
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function () { this.removeAttribute('open'); });
    rpc.mockReset();
    rpc.mockImplementation(async (_pluginId, method) => {
      if (method === 'orgs') return { ok: true, orgs, selectedAlias: 'dev' };
      if (method === 'status') return { ok: true, defaultOrg: 'dev', selectedAlias: 'dev', dxProject: true, orgs };
      if (method === 'operations.list') return { ok: true, operations: [] };
      if (method === 'context.select') return { ok: true };
      return { ok: false, error: `unexpected ${method}` };
    });
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
    vi.restoreAllMocks();
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
    expect(setSettings).not.toHaveBeenCalled();
    await act(async () => { [...el.querySelectorAll('button')].find(button => button.textContent === 'Set shared default')!.click(); });
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
    expect(el.textContent).toContain('Connections from Salesforce CLI');
    expect(el.querySelector('[data-testid="salesforce-connect-orgs"]')).toBeTruthy();
  });

  it('starts CLI web login from Connect more orgs', async () => {
    rpc.mockImplementation(async (_pluginId: string, method: string) => {
      if (method === 'orgs') return { ok: true, orgs, selectedAlias: 'dev' };
      if (method === 'orgs.login.start') return { ok: true, loginId: 'login' };
      if (method === 'orgs.login.status') return { ok: true, done: true, result: { ok: true, orgs, selectedAlias: 'dev' } };
      return { ok: false, error: `unexpected ${method}` };
    });
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce' }));
    await act(async () => {
      (el.querySelector('[data-testid="salesforce-connect-orgs"]') as HTMLButtonElement).click();
    });
    const form = el.querySelector('[data-testid="salesforce-org-login"]') as HTMLFormElement;
    expect(form).toBeTruthy();
    await act(async () => {
      (form.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'orgs.login.start', { instance: 'production', alias: undefined });
  });

  it('renders CLI orgs on the Salesforce project tab', async () => {
    const el = await mount(createElement(SalesforceProjectTab, { pluginId: 'salesforce', projectId: 'proj-1' }));
    expect(el.querySelectorAll('[role=tab]')).toHaveLength(5);
    expect(el.textContent).toContain('Explore data');
    await act(async () => { [...el.querySelectorAll('button')].find(button => button.textContent === 'Org details')!.click(); });
    expect(el.querySelector('[data-testid="salesforce-org:prod"]')).toBeTruthy();
  });

  it('opens sign-in directly from the project header', async () => {
    const el = await mount(createElement(SalesforceProjectTab, { pluginId: 'salesforce', projectId: 'proj-1' }));
    await act(async () => { [...el.querySelectorAll('button')].find(button => button.textContent === 'Connect org')!.click(); });
    expect(el.querySelector('[data-testid="salesforce-org-login"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-org-list"]')).toBeNull();
    expect(el.textContent).toContain('selected for this project');
    rpc.mockImplementation(async (_id, method) => method === 'orgs.login.start' ? { ok: true, loginId: 'login' } : method === 'orgs.login.status' ? { ok: true, done: true, result: { ok: true, orgs, selectedAlias: 'dev', connectedAlias: 'dev' } } : { ok: true, orgs, selectedAlias: 'dev' });
    await act(async () => { fireEvent.submit(el.querySelector('form')!); });
    expect(el.querySelector('form')).toBeNull();
    await act(async () => { el.querySelector<HTMLButtonElement>('.sf-header .primary')!.click(); });
    expect(el.querySelector('form')).toBeTruthy();
  });

  it('shows refresh and selection errors without changing the shared default', async () => {
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce', projectId: 'proj-1' }));
    rpc.mockImplementation(async (_id, method) => {
      if (method === 'context.select') return { ok: false, error: 'Project unavailable' };
      throw Error('CLI unavailable');
    });
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-org:prod"]')!.click(); });
    await act(async () => { [...el.querySelectorAll('button')].find(button => button.textContent === 'Use for this project')!.click(); });
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('Project unavailable');
    await act(async () => { [...el.querySelectorAll('button')].find(button => button.textContent === 'Refresh')!.click(); });
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('CLI unavailable');
    expect(el.textContent).toContain('No connected orgs yet');
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('filters the roster and can reset a project to the shared default', async () => {
    const onSelect = vi.fn();
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce', projectId: 'proj-1', onSelect }));
    await act(async () => { fireEvent.change(el.querySelector('[aria-label="Search connected orgs"]')!, { target: { value: 'prod' } }); });
    expect(el.querySelectorAll('[data-testid^="salesforce-org:"]')).toHaveLength(1);
    await act(async () => { [...el.querySelectorAll('button')].find(button => button.textContent === 'Use shared default')!.click(); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'context.select', { projectId: 'proj-1', selectedAlias: '' });
    expect(onSelect).toHaveBeenCalledWith('');
  });

  it('signs in through My Domain and refreshes the selected project and other pickers', async () => {
    const onSelect = vi.fn();
    rpc.mockImplementation(async (_id, method) => {
      if (method === 'orgs.login.start') return { ok: true, loginId: 'login' };
      if (method === 'orgs.login.status') return { ok: true, done: true, result: { ok: true, orgs, selectedAlias: 'prod', connectedAlias: 'prod' } };
      return { ok: true, orgs, selectedAlias: 'prod' };
    });
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce', projectId: 'proj-1', loginRequest: 1, onSelect }));
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="My Domain"]')!); });
    await act(async () => {
      fireEvent.change(el.querySelector('[aria-label="My Domain URL"]')!, { target: { value: 'company.my.salesforce.com' } });
      fireEvent.change(el.querySelector('[aria-label="Org alias"]')!, { target: { value: ' new ' } });
    });
    await act(async () => { fireEvent.submit(el.querySelector('form')!); });
    expect(rpc).toHaveBeenCalledWith('salesforce', 'orgs.login.start', { projectId: 'proj-1', instance: 'custom', instanceUrl: 'company.my.salesforce.com', alias: 'new' });
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('selected it for this project');
    expect(onSelect).toHaveBeenCalledWith('prod');
    expect(setSettings).not.toHaveBeenCalled();
    expect(rpc.mock.calls.filter(([, method]) => method === 'orgs').length).toBeGreaterThan(1);
  });

  it('rejects an invalid My Domain before opening a browser', async () => {
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce', loginRequest: 1 }));
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="My Domain"]')!); });
    await act(async () => { fireEvent.change(el.querySelector('[aria-label="My Domain URL"]')!, { target: { value: 'http://evil.example' } }); });
    await act(async () => { fireEvent.submit(el.querySelector('form')!); });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('HTTPS Salesforce');
    expect(rpc.mock.calls.some(([, method]) => method === 'orgs.login.start')).toBe(false);
  });

  it.each(['result', 'throw', 'warning'])('keeps existing connections and reports login %s', async mode => {
    const onSelect = vi.fn();
    rpc.mockImplementation(async (_id, method) => {
      if (method === 'orgs') return { ok: true, orgs, selectedAlias: 'dev' };
      if (mode === 'throw') throw Error('Browser unavailable');
      if (mode === 'warning') return method === 'orgs.login.start' ? { ok: true, loginId: 'login' } : { ok: true, done: true, result: { ok: true, orgs, selectedAlias: 'dev', warning: 'Signed in; select the org.' } };
      return { ok: false, error: 'Sign-in timed out', orgs: [] };
    });
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce', projectId: 'proj-1', loginRequest: 1, onSelect }));
    await act(async () => { fireEvent.submit(el.querySelector('form')!); });
    expect(el.querySelectorAll('[data-testid^="salesforce-org:"]')).toHaveLength(2);
    expect(el.querySelector(mode === 'warning' ? '[role="status"]' : '[role="alert"]')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('suppresses duplicate submissions and ignores a late login after the project changes', async () => {
    let finish!: (result: unknown) => void;
    rpc.mockImplementation(async (_id, method) => {
      if (method === 'orgs.login.start') return { ok: true, loginId: 'login' };
      if (method === 'orgs.login.status') return new Promise(resolve => { finish = resolve; });
      return { ok: true, orgs, selectedAlias: 'dev' };
    });
    const el = document.createElement('div');
    const root = createRoot(el);
    nodes.push({ unmount: () => root.unmount() });
    const onSelect = vi.fn();
    await act(async () => { root.render(createElement(OrgPicker, { pluginId: 'salesforce', projectId: 'first', loginRequest: 1, onSelect })); });
    await act(async () => { fireEvent.submit(el.querySelector('form')!); fireEvent.submit(el.querySelector('form')!); });
    expect(rpc.mock.calls.filter(([, method]) => method === 'orgs.login.start')).toHaveLength(1);
    expect(el.textContent).toContain('Waiting for sign-in');
    await act(async () => { root.render(createElement(OrgPicker, { pluginId: 'salesforce', projectId: 'second', loginRequest: 1, onSelect })); });
    await act(async () => { finish({ ok: true, done: true, result: { ok: true, orgs, selectedAlias: 'prod', connectedAlias: 'prod' } }); });
    expect(onSelect).not.toHaveBeenCalled();
    expect(el.querySelector('[role="status"]')).toBeNull();
  });

  it('dismisses with Cancel, close, and native Escape without authenticating', async () => {
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce' }));
    const trigger = el.querySelector<HTMLButtonElement>('[data-testid="salesforce-connect-orgs"]')!;
    for (const action of ['cancel', 'close', 'escape']) {
      trigger.focus();
      await act(async () => { trigger.click(); });
      expect(el.querySelector('dialog[open]')).toBeTruthy();
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Production');
      await act(async () => {
        if (action === 'escape') fireEvent(el.querySelector('dialog')!, new Event('cancel', { cancelable: true }));
        else if (action === 'close') el.querySelector<HTMLButtonElement>('[aria-label="Close connection dialog"]')!.click();
        else [...el.querySelectorAll('button')].find(button => button.textContent === 'Cancel')!.click();
      });
      expect(el.querySelector('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    }
    expect(rpc.mock.calls.some(([, method]) => method === 'orgs.login.start')).toBe(false);
  });

  it('continues sign-in when dismissed and restores the pending dialog', async () => {
    let finish!: (result: unknown) => void;
    rpc.mockImplementation(async (_id, method) => {
      if (method === 'orgs.login.start') return { ok: true, loginId: 'login' };
      if (method === 'orgs.login.status') return new Promise(resolve => { finish = resolve; });
      return { ok: true, orgs, selectedAlias: 'dev' };
    });
    const el = await mount(createElement(OrgPicker, { pluginId: 'salesforce', loginRequest: 1 }));
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="Sandbox"]')!); });
    await act(async () => { fireEvent.submit(el.querySelector('form')!); });
    expect(el.querySelector<HTMLInputElement>('[aria-label="Org alias"]')!.disabled).toBe(true);
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Finish signing in');
    await act(async () => { [...el.querySelectorAll('button')].find(button => button.textContent === 'Close')!.click(); });
    expect(el.querySelector('dialog')).toBeNull();
    await act(async () => { el.querySelector<HTMLButtonElement>('[data-testid="salesforce-connect-orgs"]')!.click(); });
    expect(el.querySelector<HTMLInputElement>('[aria-label="Sandbox"]')!.checked).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await act(async () => { finish({ ok: true, done: true, result: { ok: true, orgs, selectedAlias: 'dev', connectedAlias: 'dev' } }); });
    expect(el.querySelector('dialog')).toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Connected dev');
    expect(rpc.mock.calls.filter(([, method]) => method === 'orgs.login.start')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('salesforce', 'orgs.login.start', { instance: 'sandbox', alias: undefined });
  });

  it('renders the unlisted Salesforce orgs panel', async () => {
    const el = await mount(createElement(SalesforceOrgsPanel, { pluginId: 'salesforce', subPath: '' }));
    expect(el.querySelector('[data-testid="salesforce-orgs-panel"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-org-list"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="salesforce-connect-orgs"]')).toBeTruthy();
  });
});
