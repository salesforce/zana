/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent, within } from '@testing-library/react';
import type { PluginCreateProjectDialogProps } from '@zana-ai/zcc-plugin-sdk/app';
import { CreateSalesforceProjectDialog } from './CreateSalesforceProjectDialog.js';

const orgs = [{ alias: 'dev', username: 'dev@example.com' }];
const rpc = vi.fn();
let root: Root;
let el: HTMLDivElement;
let props: PluginCreateProjectDialogProps;
const ui = () => within(el);
const click = async (name: string) => act(async () => { fireEvent.click(ui().getByRole('button', { name, exact: true })); });
const change = async (label: string, value: string) => act(async () => { fireEvent.change(ui().getByLabelText(label, { exact: true }), { target: { value } }); });
const submit = async () => act(async () => { fireEvent.submit(el.querySelector('form')!); });
async function mount() { await act(async () => { root.render(createElement(CreateSalesforceProjectDialog, props)); }); }

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  rpc.mockReset().mockImplementation(async (_id, method) => {
    if (method === 'orgs') return { ok: true, orgs };
    if (method === 'orgs.login.start') return { ok: true, loginId: 'login' };
    if (method === 'orgs.login.status') return { ok: true, done: true, result: { ok: true, orgs, connectedAlias: 'dev' } };
    if (method === 'project.generate') return { ok: true, path: '/projects/dev' };
    return { ok: true };
  });
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
  props = { pluginId: 'salesforce', params: null, cloneRoot: vi.fn(async () => '/projects'),
    pickDirectory: vi.fn(async () => '/chosen'), addProject: vi.fn(async () => ({ id: 'p1' })), toProject: vi.fn(), close: vi.fn() };
  el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; });

describe('Salesforce project setup', () => {
  it('starts with login and creates nothing until connected and explicitly submitted', async () => {
    await mount();
    expect(ui().getByRole('button', { name: 'Log in to Salesforce' })).toBeTruthy();
    expect(ui().queryByLabelText('Project name')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    await submit();
    expect(ui().getByLabelText<HTMLInputElement>('Project name').value).toBe('dev');
    expect(ui().getByLabelText<HTMLInputElement>('Parent folder').value).toBe('/projects');
    expect(rpc.mock.calls.some(([, method]) => method === 'project.generate')).toBe(false);
    await submit();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'project.generate', { name: 'dev', outputDir: '/projects' });
    expect(props.addProject).toHaveBeenCalledWith('/projects/dev');
    expect(rpc).toHaveBeenCalledWith('salesforce', 'project.connect', { projectId: 'p1', selectedAlias: 'dev' });
    expect(props.toProject).toHaveBeenCalledWith('p1', { tabId: 'salesforce' });
    expect(props.close).toHaveBeenCalledOnce();
  });
  it('supports My Domain sign-in, aliases, and folder selection', async () => {
    await mount();
    await act(async () => { fireEvent.click(ui().getByLabelText('My Domain')); });
    await change('My Domain URL', 'company.my.salesforce.com');
    await change('Org alias', ' dev ');
    await submit();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'orgs.login.start', { instance: 'custom', instanceUrl: 'company.my.salesforce.com', alias: 'dev' });
    await click('Browse…');
    await change('Project name', ' Acme ');
    await change('Parent folder', '/work');
    await submit();
    expect(rpc).toHaveBeenCalledWith('salesforce', 'project.generate', { name: 'Acme', outputDir: '/work' });
  });
  it('rejects invalid login input before opening a browser', async () => {
    await mount();
    await act(async () => { fireEvent.click(ui().getByLabelText('My Domain')); });
    await change('My Domain URL', 'http://evil.example');
    await submit();
    expect(ui().getByRole('alert').textContent).toContain('HTTPS Salesforce');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('reuses a connected org without browser login and allows changing it', async () => {
    await mount(); await click('Use a connected org');
    expect(ui().getByRole<HTMLButtonElement>('button', { name: 'Continue' }).disabled).toBe(true);
    await submit(); expect(ui().queryByLabelText('Project name')).toBeNull();
    await change('Connected org', 'dev'); await submit();
    await click('Change org'); await click('Log in to another org');
    expect(ui().getByRole('button', { name: 'Log in to Salesforce' })).toBeTruthy();
    expect(rpc.mock.calls.some(([, method]) => method.startsWith('orgs.login'))).toBe(false);
  });
  it('recovers from an unavailable org list', async () => {
    rpc.mockResolvedValueOnce({ ok: false, error: 'CLI unavailable' });
    await mount(); await click('Use a connected org');
    expect(ui().getByRole('alert').textContent).toContain('CLI unavailable');
    await click('Refresh');
    expect(ui().getByRole('option', { name: /dev@example/ })).toBeTruthy();
  });
  it('asks for an explicit org when login cannot identify the new connection', async () => {
    rpc.mockImplementation(async (_id, method) => method === 'orgs.login.start' ? { ok: true, loginId: 'id' } : { ok: true, done: true, result: { ok: true, orgs, warning: 'Choose your signed-in org.' } });
    await mount(); await submit();
    expect(ui().getByRole('alert').textContent).toBe('Choose your signed-in org.');
    expect(ui().getByLabelText('Connected org')).toBeTruthy();
    expect(props.addProject).not.toHaveBeenCalled();
  });
  it('reports failed sign-in and leaves folder creation untouched', async () => {
    rpc.mockResolvedValue({ ok: false, error: 'Sign-in cancelled' });
    await mount(); await submit();
    expect(ui().getByRole('alert').textContent).toBe('Sign-in cancelled');
    expect(ui().queryByLabelText('Project name')).toBeNull();
    await click('Cancel'); expect(props.close).toHaveBeenCalledOnce();
  });
  it('suppresses duplicate login and ignores a result after the dialog closes', async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementation(async (_id, method) => method === 'orgs.login.start' ? { ok: true, loginId: 'id' } : new Promise(resolve => { finish = resolve; }));
    await mount();
    await act(async () => { fireEvent.submit(el.querySelector('form')!); fireEvent.submit(el.querySelector('form')!); });
    expect(rpc.mock.calls.filter(([, method]) => method === 'orgs.login.start')).toHaveLength(1);
    expect(ui().getByRole('status').textContent).toContain('No folder has been created');
    await click('Close');
    await act(async () => { root.render(null); });
    await act(async () => { finish({ ok: true, done: true, result: { ok: true, connectedAlias: 'dev', orgs } }); });
    expect(props.addProject).not.toHaveBeenCalled();
    expect(props.toProject).not.toHaveBeenCalled();
  });
  it.each(['generate', 'register', 'connect'])('retries a %s failure without repeating successful local steps', async stage => {
    await mount(); await submit();
    if (stage === 'register') vi.mocked(props.addProject).mockResolvedValueOnce(null);
    else rpc.mockResolvedValueOnce({ ok: false, error: 'Temporary failure' });
    if (stage === 'connect') rpc.mockReset().mockImplementationOnce(async () => ({ ok: true, path: '/projects/dev' })).mockImplementationOnce(async () => ({ ok: false, error: 'Temporary failure' })).mockResolvedValue({ ok: true });
    await submit();
    expect(ui().getByRole('alert')).toBeTruthy();
    expect(props.toProject).not.toHaveBeenCalled();
    await submit();
    expect(props.toProject).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.filter(([, method]) => method === 'project.generate')).toHaveLength(stage === 'generate' ? 2 : 1);
    expect(props.addProject).toHaveBeenCalledTimes(stage === 'register' ? 2 : 1);
  });
  it('requires a folder when no default is available and handles cancelled folder selection', async () => {
    vi.mocked(props.cloneRoot).mockRejectedValue(Error('No default'));
    vi.mocked(props.pickDirectory).mockResolvedValue(null);
    await mount(); await submit(); await click('Browse…'); await submit();
    expect(ui().getByRole<HTMLButtonElement>('button', { name: 'Create project' }).disabled).toBe(true);
    expect(props.addProject).not.toHaveBeenCalled();
    await change('Parent folder', '/work');
    expect(ui().getByRole<HTMLButtonElement>('button', { name: 'Create project' }).disabled).toBe(false);
  });
});
