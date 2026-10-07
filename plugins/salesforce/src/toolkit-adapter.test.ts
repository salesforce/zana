import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, mkdir, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SalesforceToolkitAdapter, providerTools, toolkitNativeSchema, toolProvider } from '../lib/toolkit-adapter.js';
import type { SalesforceSdk } from '../lib/sdk-contract.js';
import type { SalesforceToolProvider, ToolkitRuntime } from '../lib/tool-provider-contract.js';
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });
async function setup() {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'sf-adapter-'))); cleanups.push(() => rm(workspace, { recursive: true, force: true }));
  let mode: SalesforceToolProvider = 'both';
  const scope = { projectId: 'p', workspace, orgAlias: 'dev' };
  const org = { orgId: '00D1', alias: 'dev', username: 'dev@example.com', kind: 'sandbox' };
  const connect = vi.fn(async () => org);
  const confirm = vi.fn(async () => ({ approved: true, reason: 'sandbox' }));
  const runtime: ToolkitRuntime = {
    executeTool: vi.fn(async (_name, _input, options) => {
      const id = randomUUID(), dir = join(options.artifactDir, id); await mkdir(dir);
      const runFile = join(dir, 'run.json'), resultFile = join(dir, 'result.json');
      await writeFile(runFile, '{}'); await writeFile(resultFile, JSON.stringify({ data: { value: 'evidence' } }));
      return { ok: true, data: { accessToken: 'secret', value: 'evidence' }, execution: { runId: id, runFile, resultFile } };
    }),
    toModelResult: vi.fn(result => structuredClone(result)),
    readResult: vi.fn(async () => ({ data: { value: 'evidence', password: 'secret' } }))
  };
  const loadRuntime = vi.fn(async () => runtime);
  const adapter = new SalesforceToolkitAdapter({ provider: async () => mode, scope: async () => ({ ...scope }), sdk: { connect, confirm } as unknown as SalesforceSdk, loadRuntime });
  cleanups.push(() => adapter.dispose());
  return { adapter, scope, org, runtime, connect, confirm, loadRuntime, setMode: (value: SalesforceToolProvider) => { mode = value; } };
}
const ctx = { projectId: 'p', threadId: 't' };

describe('provider boundary', () => {
  it('selects independent catalogs and strips host authority from direct schemas', () => {
    expect(toolProvider('bad')).toBe('both'); expect(toolProvider('builtin')).toBe('builtin'); expect(toolProvider('toolkit')).toBe('toolkit');
    expect(providerTools('builtin', true)).toEqual(['sf_soql', 'sf_apex', 'sf_lwc', 'sf_agent', 'sf_workbench']);
    expect(providerTools('builtin', false)).toEqual(['sf_workbench', 'sf_agent']);
    expect(providerTools('toolkit', true)).toEqual(['sf_workbench', 'sf_tools', 'sf_flow', 'code_analyzer', 'sf_metadata']);
    expect(providerTools('both', false)).toContain('sf_agent');
    expect(toolkitNativeSchema('sf_flow').properties).not.toHaveProperty('target_org');
    expect(toolkitNativeSchema('sf_flow').properties).not.toHaveProperty('workspace');
    expect(toolkitNativeSchema('sf_flow').properties).toHaveProperty('resumeId');
  });
  it('discovers without loading SDK; built-in mode refuses stale calls', async () => {
    const f = await setup();
    expect((await f.adapter.catalog()).tools).toHaveLength(21);
    expect(await f.adapter.describe('sf_soql')).toMatchObject({ ok: true, actions: { 'query.run': { available: true } } });
    expect(await f.adapter.describe('bad')).toMatchObject({ code: 'unknown_tool' });
    f.setMode('builtin'); expect(await f.adapter.invoke('sf_flow', {}, ctx)).toMatchObject({ code: 'provider_disabled' });
    expect(await f.adapter.read('bad', ctx)).toMatchObject({ code: 'provider_disabled' }); expect(f.loadRuntime).not.toHaveBeenCalled();
  });
});

describe('host-owned execution', () => {
  it('allows local diagnostics without org, redacts results and supports opaque evidence/resume', async () => {
    const f = await setup(); f.scope.orgAlias = '';
    const result = await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx);
    expect(result).toMatchObject({ ok: true, data: { accessToken: '[redacted]' } });
    expect(Object.keys(result.execution)).toEqual(['runId']); expect(f.connect).not.toHaveBeenCalled();
    expect(await f.adapter.read(result.execution.runId, ctx, { limit: 1000 })).toMatchObject({ data: { password: '[redacted]' } });
    expect(f.runtime.readResult).toHaveBeenCalledWith(expect.any(String), { limit: 100 });
    await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx, result.execution.runId);
    expect(f.runtime.executeTool).toHaveBeenLastCalledWith('sf_flow', expect.anything(), expect.objectContaining({ workspace: f.scope.workspace, resume: expect.stringContaining('run.json'), allowEffects: false }));
    await f.adapter.read(result.execution.runId, ctx, { limit: NaN }); expect(f.runtime.readResult).toHaveBeenLastCalledWith(expect.anything(), { limit: 20 });
  });
  it('pins org username and asks approval for effects, never granting a caller override', async () => {
    const f = await setup();
    await f.adapter.invoke('sf_soql', { action: 'query.run', query: 'SELECT Id FROM Account LIMIT 1', target_org: 'dev' }, ctx);
    expect(f.runtime.executeTool).toHaveBeenCalledWith('sf_soql', expect.objectContaining({ target_org: 'dev@example.com' }), expect.objectContaining({ allowEffects: false }));
    await f.adapter.invoke('sf_apex', { action: 'test.run' }, ctx);
    expect(f.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'org.write', orgId: '00D1', fingerprint: expect.any(String) }), 't');
    expect(f.runtime.executeTool).toHaveBeenLastCalledWith('sf_apex', expect.anything(), expect.objectContaining({ allowEffects: true }));
    expect(await f.adapter.invoke('sf_apex', { action: 'test.run', allowEffects: true }, ctx)).toMatchObject({ ok: false });
    f.confirm.mockResolvedValue({ approved: false, reason: 'denied' });
    expect(await f.adapter.invoke('sf_flow', { action: 'fix.apply' }, ctx)).toMatchObject({ code: 'refused' });
  });
  it('rejects absent/changed org, cross-project result/resume and changed approval context', async () => {
    const f = await setup();
    const result = await f.adapter.invoke('sf_soql', { action: 'status' }, ctx);
    f.org.orgId = 'other'; expect(await f.adapter.read(result.execution.runId, ctx)).toMatchObject({ code: 'scope_mismatch' });
    expect(await f.adapter.invoke('sf_soql', { action: 'status' }, ctx, result.execution.runId)).toMatchObject({ code: 'scope_mismatch' });
    f.scope.projectId = 'other'; expect(await f.adapter.read(result.execution.runId, ctx)).toMatchObject({ code: 'scope_mismatch' }); f.scope.projectId = 'p';
    f.scope.orgAlias = ''; expect(await f.adapter.invoke('sf_soql', { action: 'status' }, ctx)).toMatchObject({ code: 'org_required' });
    expect(await f.adapter.read('missing', ctx)).toMatchObject({ code: 'scope_mismatch' });
    f.confirm.mockImplementation(async () => { f.scope.orgAlias = 'changed'; return { approved: true, reason: 'sandbox' }; });
    expect(await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx)).toMatchObject({ code: 'scope_mismatch' });
  });
  it('rechecks provider after approval, rejects unknown tools and handles runtime failures', async () => {
    const f = await setup();
    expect(await f.adapter.invoke('unknown', {}, ctx)).toMatchObject({ code: 'unknown_tool' });
    f.confirm.mockImplementationOnce(async () => { f.setMode('builtin'); return { approved: true, reason: 'sandbox' }; });
    expect(await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx)).toMatchObject({ code: 'provider_disabled' });
    f.setMode('both'); f.loadRuntime.mockRejectedValueOnce(Error('missing runtime'));
    expect(await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx)).toMatchObject({ code: 'toolkit_failed' });
    f.runtime.readResult = vi.fn(async () => { throw Error('missing evidence'); });
    const r = await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx);
    expect(await f.adapter.read(r.execution.runId, ctx)).toMatchObject({ code: 'toolkit_failed' });
  });
  it('bounds concurrency, propagates cancellation and cleans evidence on disposal', async () => {
    const f = await setup();
    const r = await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx);
    const options = vi.mocked(f.runtime.executeTool).mock.calls[0][2];
    f.runtime.executeTool = vi.fn(async (_n, _i, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })));
    const controller = new AbortController();
    const calls = Array.from({ length: 4 }, () => f.adapter.invoke('sf_flow', { action: 'quality.rules' }, { ...ctx, signal: controller.signal }));
    await vi.waitFor(() => expect(f.runtime.executeTool).toHaveBeenCalledTimes(4));
    expect(await f.adapter.invoke('sf_flow', {}, ctx)).toMatchObject({ code: 'busy' }); controller.abort();
    expect(await Promise.all(calls)).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({ code: 'interrupted' })));
    expect(await f.adapter.invoke('sf_flow', {}, { ...ctx, signal: controller.signal })).toMatchObject({ code: 'interrupted' });
    await f.adapter.dispose(); expect(await stat(options.artifactDir).catch(() => null)).toBeNull();
    expect(await f.adapter.invoke('sf_flow', {}, ctx)).toMatchObject({ code: 'unavailable' }); expect(await f.adapter.read(r.execution.runId, ctx)).toMatchObject({ code: 'provider_disabled' });
  });
  it('evicts older evidence, cleans unsuccessful calls and rejects foreign execution paths', async () => {
    const f = await setup(); let first: any;
    for (let i = 0; i < 33; i++) { const r = await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx); if (!i) first = r; }
    expect(await f.adapter.read(first.execution.runId, ctx)).toMatchObject({ code: 'scope_mismatch' });
    const options = vi.mocked(f.runtime.executeTool).mock.calls[0][2]; expect(await stat(options.artifactDir).catch(() => null)).toBeNull();
    f.runtime.executeTool = vi.fn(async () => ({ ok: false, error: { code: 'INPUT' } }));
    expect(await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx)).toMatchObject({ ok: false });
    const emptyDir = vi.mocked(f.runtime.executeTool).mock.calls[0][2].artifactDir; expect(await stat(emptyDir).catch(() => null)).toBeNull();
    f.runtime.executeTool = vi.fn(async () => ({ ok: true, execution: { runId: randomUUID(), runFile: '/outside/run.json', resultFile: '/outside/result.json' } }));
    expect(await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx)).toMatchObject({ code: 'toolkit_failed' });
    f.runtime.executeTool = vi.fn(async (_n, _i, opts) => { await symlink(f.scope.workspace, join(opts.artifactDir, 'link')); return { ok: true }; });
    expect(await f.adapter.invoke('sf_flow', { action: 'quality.rules' }, ctx)).toMatchObject({ code: 'toolkit_failed' });
  });
});
