import { mkdtemp, realpath, mkdir, symlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import catalog from '../vendor/catalog.json';
import { confinedToolkitPath, isLocalToolkitCall, prepareToolkitInput, redactToolkitResult, toolkitRequiresApproval } from '../lib/toolkit-policy.js';
import type { ToolkitDescription } from '../lib/tool-provider-contract.js';
const dirs: string[] = [];
async function root() { const p = await realpath(await mkdtemp(join(tmpdir(), 'sf-policy-'))); dirs.push(p); return p; }
afterEach(async () => { await Promise.all(dirs.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const description = (name: string) => catalog.tools.find(t => t.name === name)! as unknown as ToolkitDescription;

describe('toolkit input authority', () => {
  it('confines existing files, new output ancestors and nested Data 360 paths', async () => {
    const p = await root(); await writeFile(join(p, 'a.cls'), '');
    expect(await confinedToolkitPath(p, '@a.cls')).toBe(join(p, 'a.cls'));
    expect(await confinedToolkitPath(p, 'new/deep/out.xml')).toBe(join(p, 'new/deep/out.xml'));
    expect(await prepareToolkitInput('data360_prepare', { action: 'csv.infer_schema', params: { csvPath: 'a.cls' } }, p, null)).toMatchObject({ params: { csvPath: join(p, 'a.cls') } });
    expect(await prepareToolkitInput('sf_apex', { target: 'MyTest', targets: ['a.cls'] }, p, null)).toMatchObject({ target: 'MyTest', targets: [join(p, 'a.cls')] });
    expect(await prepareToolkitInput('sf_metadata', { manifest: 'a.cls', workspace: '.', target_org: 'dev' }, p, 'dev')).not.toHaveProperty('target_org');
    await expect(prepareToolkitInput('code_analyzer', { output_files: [{ path: 'new/out.json', content: '{}' }] }, p, null)).resolves.toBeTruthy();
    await expect(prepareToolkitInput('data360_orchestrate', { action: 'manifest.plan', params: { manifest: { datasets: [{ csvPath: 'a.cls' }] } } }, p, null)).resolves.toMatchObject({ params: { manifest: { datasets: [{ csvPath: join(p, 'a.cls') }] } } });
  });
  it('rejects escapes, dangling links, wildcard roots, and hostile authority fields', async () => {
    const p = await root(), outside = await root();
    await mkdir(join(outside, 'actual')); await symlink(outside, join(p, 'link')); await symlink(join(outside, 'missing'), join(p, 'dangling'));
    for (const path of ['../outside', join(outside, 'actual'), 'link/new.json', 'dangling/file', '*.cls', '~/x', '', 'x\0y']) await expect(confinedToolkitPath(p, path)).rejects.toThrow();
    for (const input of [{ file: '../x' }, { params: { manifestPath: '../x' } }, { params: { csvPath: '../x' } }, { params: { path: '../x' }, action: 'ingest_job.upload_csv' }, { workspace: '/other' }, { workspace: [p, '/other'] }, { target_org: 'other' }, { params: { target_org: 'dev' } }, { resume: '/tmp/x' }, { allowEffects: true }, { username_override: 'other' }, { constructor: {} }, { file: [42] }]) await expect(prepareToolkitInput('data360_prepare', input, p, 'dev')).rejects.toThrow();
    for (const input of [null, [], { value: 'x'.repeat(200_001) }]) await expect(prepareToolkitInput('sf_flow', input, p, null)).rejects.toThrow();
    let deep: any = {}; for (let i = 0; i < 18; i++) deep = { nested: [deep] };
    await expect(prepareToolkitInput('sf_flow', deep, p, null)).rejects.toThrow(/nested/);
  });
});

describe('toolkit authorization', () => {
  it.each([
    ['sf_flow', { action: 'quality.rules' }, true], ['sf_flow', { action: 'flow.inspect', file: 'a.xml' }, true], ['sf_flow', { action: 'flow.inspect' }, false],
    ['sf_apex', { action: 'diagnose.file' }, true], ['sf_apex', { action: 'log.analyze' }, false], ['sf_apex', { action: 'log.analyze', file: 'x.log' }, true],
    ['sf_apex', { action: 'diagnose.file', semantic_checks: true }, true], ['data360_prepare', { action: 'csv.infer_schema' }, true],
    ['sf_lwc', { action: 'project.scan' }, true], ['code_analyzer', { action: 'doctor' }, true], ['sf_soql', { action: 'lsp.status' }, true], ['sf_soql', { action: 'query.run' }, false],
    ['sf_metadata', { action: 'manifest' }, true], ['sf_metadata', { action: 'inventory' }, false], ['data360_query', { action: 'help' }, true],
    ['agentscript_authoring', { verb: 'compile', mode: 'check' }, true], ['agentscript_authoring', { verb: 'inspect', mode: 'review' }, false],
    ['agentscript_authoring', { verb: 'compile', fallback: 'server' }, false], ['agentscript_authoring', { verb: 'inspect', mode: 'check_targets' }, false]
  ])('classifies %s %j', (name, input, local) => expect(isLocalToolkitCall(name as string, input as any)).toBe(local));
  it('covers declared effects, derived outputs, dry-run and missing actions', () => {
    expect(toolkitRequiresApproval(description('sf_flow'), { action: 'quality.rules' })).toBe(false);
    expect(toolkitRequiresApproval(description('sf_flow'), { action: 'fix.apply' })).toBe(true);
    expect(toolkitRequiresApproval(description('sf_flow'), { action: 'invented' })).toBe(true);
    expect(toolkitRequiresApproval(description('sf_metadata'), { action: 'manifest', output_path: 'x' })).toBe(true);
    expect(toolkitRequiresApproval(description('agentscript_authoring'), { verb: 'compile' })).toBe(false);
    expect(toolkitRequiresApproval(description('agentscript_authoring'), { verb: 'inspect', output_files: ['x'] })).toBe(true);
    expect(toolkitRequiresApproval(description('agentscript_authoring'), { verb: 'create' })).toBe(true);
    expect(toolkitRequiresApproval(description('agentscript_authoring'), { verb: 'compile', fallback: 'server' })).toBe(true);
    expect(toolkitRequiresApproval({ ...description('sf_flow'), actions: { effect: { available: true, effects: true, dryRun: true } } }, { action: 'effect', dry_run: true })).toBe(false);
  });
  it('redacts credentials recursively while preserving diagnostics', () => {
    expect(redactToolkitResult({ password: 'secret', data: [{ accessToken: 'secret', message: 'diagnostic' }], cookies: { x: 'secret' } })).toEqual({ password: '[redacted]', data: [{ accessToken: '[redacted]', message: 'diagnostic' }], cookies: '[redacted]' });
    let deep: any = 'value'; for (let i = 0; i < 34; i++) deep = [deep];
    expect(JSON.stringify(redactToolkitResult(deep))).toContain('[omitted]');
  });
});
