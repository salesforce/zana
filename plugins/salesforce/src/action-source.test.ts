import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOrgAction, readProjectAction, ACTION_SOURCE_CAP } from '../lib/action-source.js';
import { createNodeDeps } from '../lib/node-deps.js';
import { readBoundedResponse, salesforceRestRequest } from '../lib/sf-cli.js';
import { createSalesforcePlugin } from '../lib/plugin.js';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import type { ResolvedOrg, SalesforceDeps } from '../lib/types.js';
import { ACTION_APEX, ACTION_FLOW, ACTION_FLOW_XML } from './action-fixtures.js';
const dirs: string[] = [];
const org = { alias: 'dev', username: 'dev@example.com', orgId: '00D1', instanceUrl: 'https://dev.my.salesforce.com', accessToken: 'PRIVATE_TOKEN', apiVersion: '62.0' } as ResolvedOrg;
const response = (json: unknown, status = 200) => ({ json, status, text: JSON.stringify(json) });
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sf-action-')); dirs.push(root);
  const write = (path: string, content: string) => { const full = join(root, path); mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true }); writeFileSync(full, content); };
  write('sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app' }, { path: 'second' }] }));
  write('force-app/main/default/classes/OrderLookup.cls', ACTION_APEX);
  return { root, write, deps: createNodeDeps() };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
describe('action source resolution', () => {
  it('resolves package source, reports ambiguity, and only accepts an exact confined candidate', () => {
    const { root, write, deps } = setup();
    expect(readProjectAction(root, 'apex://OrderLookup', deps)).toMatchObject({ status: 'ready', content: ACTION_APEX, origin: 'project', language: 'apex' });
    write('second/classes/OrderLookup.cls', 'second');
    expect(readProjectAction(root, 'apex://OrderLookup', deps)).toMatchObject({ status: 'ambiguous', candidates: ['force-app/main/default/classes/OrderLookup.cls', 'second/classes/OrderLookup.cls'] });
    expect(readProjectAction(root, 'apex://OrderLookup', deps, 'second/classes/OrderLookup.cls').content).toBe('second');
    expect(() => readProjectAction(root, 'apex://OrderLookup', deps, '../secret')).toThrow('not a matching');
    expect(() => readProjectAction(root, 'apex://../secret', deps)).toThrow('Only Apex');
  });
  it('does not leave the project through packages or symlinks, follows no cycles, and respects namespaces', () => {
    const { root, write, deps } = setup();
    const outside = mkdtempSync(join(tmpdir(), 'sf-outside-')); dirs.push(outside);
    writeFileSync(join(outside, 'Secret.cls'), 'secret');
    symlinkSync(outside, join(root, 'force-app', 'escape'));
    symlinkSync(join(root, 'force-app'), join(root, 'force-app', 'cycle'));
    expect(readProjectAction(root, 'apex://Secret', deps).status).toBe('missing');
    expect(readProjectAction(root, 'apex://ns.OrderLookup', deps).status).toBe('missing');
    write('sfdx-project.json', JSON.stringify({ namespace: 'ns', packageDirectories: [{ path: 'force-app' }, { path: outside }] }));
    expect(readProjectAction(root, 'apex://ns.OrderLookup', deps).status).toBe('ready');
    expect(readProjectAction(root, 'apex://Secret', deps).status).toBe('missing');
  });
  it('supports non-DX folders and Flow XML; bounds file reads and unavailable roots', () => {
    const { root, write, deps } = setup();
    rmSync(join(root, 'sfdx-project.json'));
    write('flows/CheckReturn.flow-meta.xml', '<Flow/>');
    expect(readProjectAction(root, 'flow://CheckReturn', deps)).toMatchObject({ status: 'ready', language: 'xml', content: '<Flow/>' });
    expect(readProjectAction('', 'apex://OrderLookup', deps).status).toBe('missing');
    write('force-app/main/default/classes/OrderLookup.cls', 'x'.repeat(ACTION_SOURCE_CAP + 1));
    expect(() => readProjectAction(root, 'apex://OrderLookup', deps)).toThrow('size limit');
    const legacy = { ...deps, readFileBounded: undefined };
    expect(() => readProjectAction(root, 'apex://OrderLookup', legacy)).toThrow('750 KB');
    expect(() => readProjectAction(root, 'flow://CheckReturn', { ...legacy, readFile: () => null })).toThrow('could not be read');
  });
  it('does not silently choose a match after reaching the scan limit', () => {
    const { root, deps } = setup();
    const limited = { ...deps, readdir: (p: string) => p.endsWith('force-app') ? Array.from({ length: 6001 }, (_, i) => `f${i}`) : deps.readdir(p) };
    expect(readProjectAction(root, 'apex://OrderLookup', limited)).toMatchObject({ status: 'ambiguous', message: expect.stringContaining('limit') });
    const deep = { ...deps, realpath: (p: string) => p, readdir: (p: string) => p === root ? [] : ['next'], stat: () => 'dir' as const };
    expect(readProjectAction(root, 'apex://OrderLookup', deep)).toMatchObject({ status: 'ambiguous' });
  });
  it('fetches one class and the registered action contract from the same pinned org', async () => {
    const { deps } = setup();
    const request = vi.fn(async (_org, req) => req.path === '/tooling/query' ? response({ records: [{ Body: ACTION_APEX }] }) : response({ inputs: [{ name: 'orderId', type: 'String', required: true }], outputs: [{ name: 'status', type: 'String' }] }));
    const result = await readOrgAction(org, 'apex://ns.OrderLookup', { ...deps, request });
    expect(result).toMatchObject({ status: 'ready', label: 'dev · Deployed Apex', inputs: [{ name: 'orderId', required: true }], outputs: [{ name: 'status' }] });
    expect(request.mock.calls.every(call => call[0] === org && call[1].method === 'GET' && call[1].maxResponseBytes === 2_000_000)).toBe(true);
    expect(request.mock.calls[0][1].query.q).toContain("NamespacePrefix = 'ns'");
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TOKEN');
  });
  it('shows the contract when managed source is unavailable and does not invent a contract on failure', async () => {
    const { deps } = setup();
    const result = await readOrgAction(org, 'apex://Managed', { ...deps, request: async (_o, req) => req.path === '/tooling/query' ? response([], 403) : response({ actions: [{ inputs: [{ name: 'request', dataType: 'String', isRequired: true, description: 'Input' }], outputs: [] }] }) });
    expect(result).toMatchObject({ status: 'unavailable', inputs: [{ name: 'request', required: true, description: 'Input' }] });
    const failed = await readOrgAction(org, 'apex://Missing', { ...deps, request: async () => response([], 404) });
    expect(failed.inputs).toBeUndefined(); expect(failed.contractMessage).toContain('could not be verified');
    await expect(readOrgAction(org, 'apex://Huge', { ...deps, request: async () => response({ records: [{ Body: 'x'.repeat(ACTION_SOURCE_CAP + 1) }] }) })).rejects.toThrow('750 KB');
  });
  it('retrieves only the active Flow version and its parameters', async () => {
    const { deps } = setup();
    const request = vi.fn(async () => response({ records: [{ Id: '301', VersionNumber: 4, Metadata: ACTION_FLOW }] }));
    const result = await readOrgAction(org, 'flow://CheckReturn', { ...deps, request });
    expect(result).toMatchObject({ status: 'ready', version: 4, inputs: [{ name: 'orderId', type: 'String' }], outputs: [{ name: 'eligible' }] });
    expect(request.mock.calls[0]).toEqual([org, expect.objectContaining({ query: { q: expect.stringContaining("Status = 'Active' LIMIT 1") } })]);
    for (const [json, status] of [[{}, 'missing'], [{ records: [{ Id: '301' }] }, 'unavailable']] as const) expect((await readOrgAction(org, 'flow://CheckReturn', { ...deps, request: async () => response(json) })).status).toBe(status);
    await expect(readOrgAction(org, 'flow://CheckReturn', { ...deps, request: async () => response({}, 403) })).rejects.toThrow('403');
    await expect(readOrgAction(org, 'bad', deps)).rejects.toThrow('Only Apex');
    await expect(readOrgAction(org, 'flow://Huge', { ...deps, request: async () => response({ records: [{ Id: '1', Metadata: { label: 'x'.repeat(ACTION_SOURCE_CAP) } }] }) })).rejects.toThrow('750 KB');
  });
  it('uses main-resolved project roots and rejects unknown projects over RPC', async () => {
    const { root, deps } = setup();
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p', name: 'Project', path: root }] });
    await createSalesforcePlugin(zcc, deps);
    harness.setSettings({ defaultOrg: 'dev' });
    expect(await harness.callRpc('agentActions.source', { projectId: 'p', projectRoot: '/etc', target: 'apex://OrderLookup', origin: 'project' })).toMatchObject({ ok: true, data: { content: ACTION_APEX } });
    expect(await harness.callRpc('agentActions.source', { projectId: 'unknown', target: 'apex://OrderLookup', origin: 'project' })).toMatchObject({ ok: false });
    expect(await harness.callRpc('agentActions.source', { projectId: 'p', target: 'apex://OrderLookup', origin: 'disk' })).toMatchObject({ ok: false });
    harness.setSettings({ projectRoot: root });
    expect(await harness.callRpc('agentActions.source', { target: 'apex://OrderLookup', origin: 'project' })).toMatchObject({ ok: true, data: { content: ACTION_APEX } });
    harness.setSettings({ projectRoot: '/etc' });
    const refused = await harness.callRpc('agentActions.source', { target: 'apex://OrderLookup', origin: 'project' }) as { data: unknown };
    expect(refused).toMatchObject({ ok: true, data: { status: 'missing' } });
    expect(refused.data).not.toHaveProperty('content');
    await harness.dispose();
  });
  it('bounds concurrent org previews and releases slots after completion', async () => {
    const { root, deps } = setup();
    const pending: Array<(value: ReturnType<typeof response>) => void> = [];
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p', name: 'Project', path: root }] });
    await createSalesforcePlugin(zcc, { ...deps, execSf: async () => ({ code: 0, stdout: JSON.stringify({ status: 0, result: { ...org, isSandbox: true } }), stderr: '' }), request: async () => new Promise(resolve => pending.push(resolve)) });
    harness.setSettings({ defaultOrg: 'dev' });
    const args = { projectId: 'p', origin: 'org', target: 'flow://CheckReturn' };
    const running = Array.from({ length: 4 }, () => harness.callRpc('agentActions.source', args));
    await vi.waitFor(() => expect(pending.length).toBe(4));
    expect(await harness.callRpc('agentActions.source', args)).toMatchObject({ ok: false, error: expect.stringContaining('busy') });
    pending.splice(0).forEach(resolve => resolve(response({ records: [] })));
    expect((await Promise.all(running)).every((value: any) => value.ok)).toBe(true);
    expect(await harness.callRpc('agentActions.source', { ...args, origin: 'project', target: 'apex://OrderLookup' })).toMatchObject({ ok: true });
    await harness.dispose();
  });
  it('visualizes only the authorized Flow snapshot on demand and retains source after parser failure', async () => {
    const { root, write, deps } = setup();
    write('force-app/main/default/flows/CheckReturn.flow-meta.xml', ACTION_FLOW_XML);
    const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p', name: 'Project', path: root }] });
    await createSalesforcePlugin(zcc, deps);
    const args = { projectId: 'p', target: 'flow://CheckReturn', origin: 'project', visualize: true };
    expect(await harness.callRpc('agentActions.source', { ...args, projectId: 'unknown' })).toMatchObject({ ok: false });
    const ordinary: any = await harness.callRpc('agentActions.source', { ...args, visualize: false });
    expect(ordinary.data.visualization).toBeUndefined();
    const rendered: any = await harness.callRpc('agentActions.source', { ...args, content: '<Flow/>', projectRoot: '/etc' });
    expect(rendered.data.visualization.data.nodes).toContainEqual(expect.objectContaining({ id: 'Eligible' }));
    write('force-app/main/default/flows/CheckReturn.flow-meta.xml', '<Flow>');
    expect(await harness.callRpc('agentActions.source', args)).toMatchObject({ ok: true, data: { content: '<Flow>', visualizationError: expect.any(String) } });
    await harness.dispose();
  });
});
describe('bounded source responses', () => {
  it('preserves complete UTF-8 across chunks and rejects oversized streams', async () => {
    expect(await readBoundedResponse(new Response('é'.repeat(9000) + 'END'), 20000)).toMatch(/END$/);
    await expect(readBoundedResponse(new Response('oversize'), 3)).rejects.toThrow('size limit');
    expect(await readBoundedResponse(new Response(null), 10)).toBe('');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    expect((await salesforceRestRequest(org, { method: 'GET', path: '/tooling/query', maxResponseBytes: 100 })).json).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalled();
  });
});
