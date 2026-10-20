import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { OrgSyncService, agentReferences, agentVersion, bareVersions, componentName, localLocator, manifest, newestVersions, packageDirectories, renameBundle, retrieveBatches } from '../lib/org-sync.js';
import { registerOrgSync } from '../lib/org-sync-rpc.js';
import type { ExecSfOptions, PublicOrgView } from '../lib/types.js';
import type { SyncJob } from '../lib/org-sync-contract.js';

const org: PublicOrgView = { alias: 'sandbox', orgId: '00D000000000001', username: 'me@example.com', instanceUrl: 'https://example.com', apiVersion: '62.0', kind: 'sandbox', isDefault: false };
const roots: string[] = [];
const services: OrgSyncService[] = [];
const ok = (result: unknown) => ({ code: 0, stdout: JSON.stringify({ status: 0, result }), stderr: '' });
const temp = (prefix = 'sf-sync-test-') => { const root = mkdtempSync(join(tmpdir(), prefix)); roots.push(root); return root; };
const put = (root: string, path: string, content: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');
const D = 'force-app/main/default';

/** An org whose components are files under `D`; dates per component key. */
function fixture() {
  const root = temp();
  put(root, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '67.0' }));
  put(root, `${D}/classes/Same.cls`, 'class Same {}');
  put(root, `${D}/classes/Same.cls-meta.xml`, '<meta/>');
  put(root, `${D}/classes/Edited.cls`, 'class Edited { local }');
  put(root, `${D}/classes/Edited.cls-meta.xml`, '<meta/>');
  put(root, `${D}/classes/LocalOnly.cls`, 'class LocalOnly {}');
  put(root, `${D}/aiAuthoringBundles/Support/Support.agent`, 'draft');
  put(root, `${D}/aiAuthoringBundles/Support_2/Support_2.agent`, 'v2');
  put(root, `${D}/lwc/card/card.js`, 'export default 1;');
  const files: Record<string, string> = {
    'classes/Same.cls': 'class Same {}', 'classes/Same.cls-meta.xml': '<meta/>',
    'classes/Edited.cls': 'class Edited { org }', 'classes/Edited.cls-meta.xml': '<meta/>',
    'classes/Fresh.cls': 'class Fresh {}', 'classes/Fresh.cls-meta.xml': '<meta/>',
    'aiAuthoringBundles/Support_2/Support_2.agent': 'v2', 'aiAuthoringBundles/Support_3/Support_3.agent': 'v3',
    'lwc/card/card.js': 'export default 2;',
  };
  const dates: Record<string, string> = { 'ApexClass:Same': '2026-01-01T00:00:00.000+0000', 'ApexClass:Edited': '2026-01-01T00:00:00.000+0000', 'ApexClass:Fresh': '2026-01-01T00:00:00.000Z', 'AiAuthoringBundle:Support_2': '2026-01-01T00:00:00.000Z', 'AiAuthoringBundle:Support_3': '2026-02-01T00:00:00.000Z', 'LightningComponentBundle:card': '2026-01-01T00:00:00.000Z' };
  const folders: Record<string, string> = { ApexClass: 'classes', AiAuthoringBundle: 'aiAuthoringBundles', LightningComponentBundle: 'lwc', ApexTrigger: 'triggers', Flow: 'flows', GenAiPromptTemplate: 'genAiPromptTemplates', LightningTypeBundle: 'lightningTypes' };
  const names = (type: string) => Object.keys(dates).filter(key => key.startsWith(`${type}:`)).map(key => key.slice(type.length + 1));
  const manifests: string[] = [];
  const execSf = vi.fn(async (args: string[], options?: ExecSfOptions) => {
    if (args[0] === 'org') {
      const type = args[args.indexOf('--metadata-type') + 1]!;
      return ok([...names(type).map(fullName => ({ fullName, lastModifiedDate: dates[`${type}:${fullName}`], lastModifiedByName: 'Ada' })), { fullName: 'Managed_1', namespacePrefix: 'ns' }]);
    }
    const xml = readFileSync(join(options!.cwd!, 'package.xml'), 'utf8');
    manifests.push(xml);
    const fileProperties: unknown[] = [];
    const retrieved: unknown[] = [];
    for (const [, members, type] of xml.matchAll(/<types>([\s\S]*?)<name>(\w+)<\/name>/g)) {
      for (const [, name] of members!.matchAll(/<members>(\w+)<\/members>/g)) {
        fileProperties.push({ type, fullName: name, lastModifiedDate: dates[`${type}:${name}`] });
        for (const [path, content] of Object.entries(files)) {
          const prefix = `${folders[type!]}/`;
          if (path.startsWith(prefix) && componentName(type as never, path.slice(prefix.length)) === name) {
            put(options!.cwd!, `${D}/${path}`, content);
            retrieved.push({ fullName: name, type, state: 'Created', filePath: join(options!.cwd!, D, path) });
          }
        }
      }
    }
    return ok({ success: true, done: true, fileProperties, files: retrieved });
  });
  const query = vi.fn(async (soql: string) => {
    const from = soql.match(/FROM (\w+)/)![1]!;
    const type = from === 'FlowDefinitionView' ? 'Flow' : from;
    const field = type === 'LightningComponentBundle' ? 'DeveloperName' : type === 'Flow' ? 'ApiName' : 'Name';
    const only = soql.match(/IN \(([^)]*)\)/)?.[1]!.split(', ').map(name => name.slice(1, -1));
    return { done: true, records: names(type).filter(name => !only || only.includes(name)).map(name => ({ [field]: name, LastModifiedDate: dates[`${type}:${name}`], LastModifiedBy: type === 'Flow' ? 'Ada' : { Name: 'Ada' } })) } as { done: boolean; nextRecordsUrl?: string; records: Array<Record<string, unknown>> };
  });
  const queryMore = vi.fn(async (_url: string) => ({ done: true, records: [] as Array<Record<string, unknown>> }));
  const stored = new Map<string, unknown>();
  const kv = { get: async <T>(key: string) => structuredClone(stored.get(key)) as T | undefined, set: async (key: string, value: unknown) => { stored.set(key, structuredClone(value)); } };
  const connect = vi.fn(async () => org);
  const service = new OrgSyncService({ execSf, connect, query, queryMore, kv, key: name => `sf:project:p:${name}` });
  services.push(service);
  return { root, service, execSf, query, queryMore, connect, kv, stored, files, dates, manifests };
}
async function settle(service: OrgSyncService, root: string, jobId: string): Promise<SyncJob> {
  await vi.waitFor(async () => expect((await service.status(root, jobId)).state).not.toBe('running'));
  return service.status(root, jobId);
}
afterEach(() => { for (const service of services.splice(0)) service.dispose(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('fetch latest helpers', () => {
  it('parses package directories, component paths, agent versions and manifests', () => {
    expect(packageDirectories(JSON.stringify({ packageDirectories: [{ path: 'a' }, { path: 'b', default: true }, { path: ' ' }] }))).toEqual(['b', 'a']);
    expect(packageDirectories('{')).toEqual(['force-app']);
    expect(packageDirectories('{}')).toEqual(['force-app']);
    expect(componentName('ApexClass', 'Foo.cls-meta.xml')).toBe('Foo');
    expect(componentName('ApexClass', 'Foo.trigger')).toBeNull();
    expect(componentName('ApexClass', 'sub/Foo.cls')).toBeNull();
    expect(componentName('ApexClass', '')).toBeNull();
    expect(componentName('ApexClass', '9x.cls')).toBeNull();
    expect(componentName('LightningComponentBundle', 'card/__tests__/card.test.js')).toBe('card');
    expect(componentName('LightningComponentBundle', 'card')).toBeNull();
    expect(componentName('Flow', 'Route.flow-meta.xml')).toBe('Route');
    expect(componentName('GenAiPromptTemplate', 'Summarize.genAiPromptTemplate-meta.xml')).toBe('Summarize');
    expect(agentReferences('target: "apex://A"\ntarget: "flow://F_1"\ntarget: "generatePromptResponse://P"\ntarget: "standardInvocableAction://sendEmail"\napex://A apex://9bad x://y')).toEqual(['ApexClass:A', 'Flow:F_1', 'GenAiPromptTemplate:P']);
    expect(agentReferences('complex_data_type_name: "c__Offer"\ncomplex_data_type_name: lightning__textType\ncomplex_data_type_name: "ns__Pkg"\ncomplex_data_type_name: Plain\ncomplex_data_type_name: "c__Offer"')).toEqual(['LightningTypeBundle:Offer', 'LightningTypeBundle:Plain']);
    expect(componentName('LightningTypeBundle', 'Offer/schema.json')).toBe('Offer');
    expect(agentVersion('Btnet_Agent_180')).toEqual({ base: 'Btnet_Agent', version: 180 });
    expect(agentVersion('Btnet_Agent')).toEqual({ base: 'Btnet_Agent', version: 0 });
    expect(manifest(['ApexClass:A', 'ApexClass:B', 'ApexTrigger:T'], '67.0')).toMatch(/<members>A<\/members>\n {4}<members>B<\/members>\n {4}<name>ApexClass<\/name>[\s\S]*<name>ApexTrigger<\/name>[\s\S]*<version>67.0<\/version>/);
    const rows = [{ name: 'Support_2', at: null, by: null }, { name: 'Support_9', at: null, by: null }, { name: 'Other_4', at: null, by: null }, { name: 'Old_1', at: null, by: null }];
    expect([...newestVersions(rows, new Map([['Support', 1], ['Old_3', 1]]))]).toEqual(['Support_9']);
  });

  it('keeps versions of one agent in different retrieve batches', () => {
    expect(retrieveBatches(['AiAuthoringBundle:A_1', 'ApexClass:X', 'AiAuthoringBundle:A_2', 'AiAuthoringBundle:B_1', 'AiAuthoringBundle:A', 'ApexClass:Y'], 3)).toEqual([
      ['AiAuthoringBundle:A_1', 'ApexClass:X', 'AiAuthoringBundle:B_1'],
      ['AiAuthoringBundle:A_2', 'ApexClass:Y'],
      ['AiAuthoringBundle:A'],
    ]);
    expect(retrieveBatches(Array.from({ length: 5 }, (_, index) => `ApexClass:C${index}`), 2).map(batch => batch.length)).toEqual([2, 2, 1]);
  });

  it('locates where the project keeps a component, in any package directory or folder layout', async () => {
    const root = realpathSync(temp());
    put(root, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }, { path: 'packages/billing' }, { path: 'gone' }] }));
    put(root, 'force-app/main/default/classes/A.cls', '');
    put(root, 'packages/billing/src/classes/B.cls', '');
    put(root, 'packages/billing/src/lwc/card/card.js', '');
    put(root, 'packages/billing/.cache/classes/C.cls', '');
    put(root, 'packages/billing/node_modules/classes/C.cls', '');
    const locate = await localLocator(root);
    expect(locate(['classes/A.cls'])).toBe(join(root, 'force-app/main/default'));
    expect(locate(['classes/Missing.cls', 'classes/B.cls'])).toBe(join(root, 'packages/billing/src'));
    expect(locate(['lwc/card/card.html', 'lwc/card/card.js'])).toBe(join(root, 'packages/billing/src'));
    expect(locate(['classes/C.cls'])).toBeUndefined();
    expect(locate([])).toBeUndefined();
  });

  it('maps an agent version returned under its base name only when that is unambiguous', () => {
    const keys = (...names: string[]) => new Set(names.map(name => `AiAuthoringBundle:${name}`));
    expect([...bareVersions(['Support', null], keys('Support_4'))]).toEqual([['Support', 'Support_4']]);
    expect(bareVersions(['Support'], keys('Support_4', 'Support_5')).size).toBe(0);
    expect(bareVersions(['Support'], keys('Support', 'Support_4')).size).toBe(0);
    expect(bareVersions(['Support', 'Support_4'], keys('Support_4')).size).toBe(0);
    expect(bareVersions(['Support'], new Set(['ApexClass:Support_4', 'AiAuthoringBundle:Other_4'])).size).toBe(0);
    expect(renameBundle('Support/Support.agent', 'Support', 'Support_4')).toBe('Support_4/Support_4.agent');
    expect(renameBundle('Support/docs/readme.md', 'Support', 'Support_4')).toBe('Support_4/docs/readme.md');
  });
});

describe('fetch latest', () => {
  it('first check marks shared components unknown, org-only new, and flags the newest agent version', async () => {
    const { service, root, query } = fixture();
    const check = await service.check(root, 'all');
    const states = Object.fromEntries(check.components.map(component => [component.key, component.state]));
    expect(states).toEqual({
      'ApexClass:Same': 'unknown', 'ApexClass:Edited': 'unknown', 'ApexClass:Fresh': 'new',
      'AiAuthoringBundle:Support_2': 'unknown', 'AiAuthoringBundle:Support_3': 'new', 'LightningComponentBundle:card': 'unknown',
    });
    expect(check.components.find(component => component.key === 'AiAuthoringBundle:Support_3')).toMatchObject({ latest: true, modifiedBy: 'Ada', modifiedAt: '2026-02-01T00:00:00.000Z' });
    expect(check.components.find(component => component.key === 'ApexClass:Same')!.modifiedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(check.counts).toMatchObject({ unknown: 4, new: 2, current: 0 });
    expect(check.org).toEqual({ alias: 'sandbox', orgId: org.orgId });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM LightningComponentBundle WHERE NamespacePrefix = null'), expect.objectContaining({ tooling: true }));
    expect((await service.check(root, 'agentforce')).components.map(component => component.type)).toEqual(['AiAuthoringBundle', 'AiAuthoringBundle']);
  });

  it('plans in a temp project, applies safe files and chosen conflicts, then reports up to date', async () => {
    const { service, root, execSf, stored, manifests } = fixture();
    await service.check(root, 'apex');
    const { jobId } = await service.start(root, { components: ['ApexClass:Same', 'ApexClass:Edited', 'ApexClass:Fresh', 'LightningComponentBundle:card'], orgId: org.orgId });
    const plan = await settle(service, root, jobId);
    expect(plan.state).toBe('ready'); if (plan.state !== 'ready') return;
    expect(plan.files.map(file => [file.path, file.action])).toEqual([
      [`${D}/classes/Edited.cls`, 'conflict'],
      [`${D}/lwc/card/card.js`, 'conflict'],
      [`${D}/classes/Fresh.cls`, 'create'],
      [`${D}/classes/Fresh.cls-meta.xml`, 'create'],
      [`${D}/classes/Edited.cls-meta.xml`, 'same'],
      [`${D}/classes/Same.cls`, 'same'],
      [`${D}/classes/Same.cls-meta.xml`, 'same'],
    ]);
    expect(plan.files[0]).toMatchObject({ added: 1, removed: 1 });
    expect(plan.components).toBe(4);
    expect(manifests[0]).toContain('<version>67.0</version>');
    const cwd = (execSf.mock.calls.at(-1)![1] as ExecSfOptions).cwd!;
    expect(execSf.mock.calls.at(-1)![0]).toEqual(['project', 'retrieve', 'start', '--manifest', 'package.xml', '--target-org', 'sandbox', '--json', '--wait', '15']);
    expect(cwd.startsWith(root)).toBe(false);
    expect(read(root, `${D}/classes/Edited.cls`)).toBe('class Edited { local }');
    expect(await service.diff(root, jobId, `${D}/classes/Edited.cls`)).toEqual({ path: `${D}/classes/Edited.cls`, local: 'class Edited { local }', org: 'class Edited { org }' });
    await expect(service.diff(root, jobId, 'nope')).rejects.toThrow('not part of the fetch');

    const applied = await service.apply(root, jobId, { take: [`${D}/classes/Edited.cls`] });
    expect(applied).toEqual({ state: 'applied', written: 3, kept: 1, skipped: [] });
    expect(read(root, `${D}/classes/Edited.cls`)).toBe('class Edited { org }');
    expect(read(root, `${D}/classes/Fresh.cls`)).toBe('class Fresh {}');
    expect(read(root, `${D}/lwc/card/card.js`)).toBe('export default 1;');
    expect(existsSync(cwd)).toBe(false);
    expect(readdirSync(join(root, D, 'classes')).some(name => name.includes('zcc-sync'))).toBe(false);
    expect(stored.get(`sf:project:p:sync:${org.orgId}:ApexClass`)).toMatchObject({ Edited: { at: '2026-01-01T00:00:00.000Z' } });
    // A second click, or a retry after a lost answer, gets the first apply's outcome and writes nothing again.
    expect(await service.apply(root, jobId, {})).toEqual(applied);

    const again = await service.check(root, 'apex');
    expect(again.components).toEqual([]);
    expect(again.counts.current).toBe(4);
  });

  it('files an agent version the org returns under its base name, and flags large diffs as truncated', async () => {
    const { service, root, execSf, dates } = fixture();
    dates['AiAuthoringBundle:Support_4'] = '2026-03-01T00:00:00.000Z';
    const large = 'v4\n' + 'x'.repeat(300_000);
    const base = execSf.getMockImplementation()!;
    execSf.mockImplementation(async (args, options) => {
      const result = await base(args, options);
      if (args[0] !== 'project') return result;
      const payload = JSON.parse(result.stdout);
      for (const [file, content] of [['Support.agent', large], ['Support.bundle-meta.xml', '<meta/>']] as const) {
        put(options!.cwd!, `${D}/aiAuthoringBundles/Support/${file}`, content);
        payload.result.files.push({ fullName: 'Support', type: 'AiAuthoringBundle', state: 'Created', filePath: join(options!.cwd!, D, 'aiAuthoringBundles/Support', file) });
      }
      return { ...result, stdout: JSON.stringify(payload) };
    });
    await service.check(root, 'agentforce');
    const { jobId } = await service.start(root, { components: ['AiAuthoringBundle:Support_4'], orgId: org.orgId });
    const plan = await settle(service, root, jobId);
    expect(plan).toMatchObject({ state: 'ready', missing: [], components: 1 });
    if (plan.state !== 'ready') return;
    expect(plan.files.map(file => [file.path, file.action])).toEqual([
      [`${D}/aiAuthoringBundles/Support_4/Support_4.agent`, 'create'],
      [`${D}/aiAuthoringBundles/Support_4/Support_4.bundle-meta.xml`, 'create'],
    ]);
    const diff = await service.diff(root, jobId, `${D}/aiAuthoringBundles/Support_4/Support_4.agent`);
    expect(diff).toMatchObject({ local: '', truncated: true });
    expect(diff.org.length).toBe(256_000);
    expect(await service.apply(root, jobId, {})).toMatchObject({ written: 2 });
    expect(read(root, `${D}/aiAuthoringBundles/Support_4/Support_4.agent`)).toBe(large);
    expect(read(root, `${D}/aiAuthoringBundles/Support/Support.agent`)).toBe('draft');
  });

  it('fetches several versions of one agent although the org returns each under the base name', async () => {
    const { service, root, execSf, dates } = fixture();
    dates['AiAuthoringBundle:Support_4'] = '2026-03-01T00:00:00.000Z';
    dates['AiAuthoringBundle:Support_5'] = '2026-04-01T00:00:00.000Z';
    execSf.mockImplementation(async (args, options) => {
      if (args[0] !== 'project') return ok([]);
      const xml = readFileSync(join(options!.cwd!, 'package.xml'), 'utf8');
      const versions = [...xml.matchAll(/<members>(Support_\d+)<\/members>/g)].map(match => match[1]!);
      // Like the org: every requested version lands in Support/, the last one winning.
      const files = versions.map(version => {
        put(options!.cwd!, `${D}/aiAuthoringBundles/Support/Support.agent`, version);
        return { fullName: 'Support', type: 'AiAuthoringBundle', state: 'Created', filePath: join(options!.cwd!, D, 'aiAuthoringBundles/Support/Support.agent') };
      });
      return ok({ success: true, done: true, files: files.slice(-1) });
    });
    const { jobId } = await service.start(root, { components: ['AiAuthoringBundle:Support_4', 'AiAuthoringBundle:Support_5'] });
    const plan = await settle(service, root, jobId);
    expect(plan).toMatchObject({ state: 'ready', missing: [], components: 2 });
    expect(execSf).toHaveBeenCalledTimes(2);
    expect(await service.apply(root, jobId, {})).toMatchObject({ state: 'applied', written: 2 });
    expect(read(root, `${D}/aiAuthoringBundles/Support_4/Support_4.agent`)).toBe('Support_4');
    expect(read(root, `${D}/aiAuthoringBundles/Support_5/Support_5.agent`)).toBe('Support_5');
  });

  it('reports an apply that fails after writing, and returns that outcome to a repeat', async () => {
    const { service, root, kv } = fixture();
    const { jobId } = await service.start(root, { components: ['ApexClass:Fresh'] });
    await settle(service, root, jobId);
    kv.set = async () => { throw Error('disk full'); };
    const failed = { state: 'failed', error: 'Wrote 2 files, then failed: disk full' };
    expect(await service.apply(root, jobId, {})).toEqual(failed);
    expect(read(root, `${D}/classes/Fresh.cls`)).toBe('class Fresh {}');
    expect(await service.apply(root, jobId, {})).toEqual(failed);
    expect(await service.status(root, jobId)).toEqual(failed);
  });

  it('separates org changes from local edits after a fetch, and reports deletions', async () => {
    const { service, root, dates, files } = fixture();
    await service.check(root, 'apex');
    const first = await service.start(root, { components: ['ApexClass:Same', 'ApexClass:Edited', 'LightningComponentBundle:card'] });
    await settle(service, root, first.jobId);
    await service.apply(root, first.jobId, { take: [`${D}/classes/Edited.cls`, `${D}/lwc/card/card.js`] });

    dates['ApexClass:Same'] = '2026-03-01T00:00:00.000Z';
    files['classes/Same.cls'] = 'class Same { v2 }';
    dates['ApexClass:Edited'] = '2026-03-01T00:00:00.000Z';
    files['classes/Edited.cls'] = 'class Edited { org v2 }';
    put(root, `${D}/classes/Edited.cls`, 'class Edited { mine }');
    delete dates['LightningComponentBundle:card'];
    const check = await service.check(root, 'apex');
    expect(Object.fromEntries(check.components.map(component => [component.key, component.state]))).toEqual({
      'ApexClass:Edited': 'conflict', 'ApexClass:Same': 'changed', 'ApexClass:Fresh': 'new', 'LightningComponentBundle:card': 'deleted',
    });

    const second = await service.start(root, { components: ['ApexClass:Same', 'ApexClass:Edited', 'ApexClass:Gone'] });
    const plan = await settle(service, root, second.jobId);
    if (plan.state !== 'ready') throw Error(plan.state);
    expect(plan.files.filter(file => file.action !== 'same').map(file => [file.path, file.action])).toEqual([[`${D}/classes/Edited.cls`, 'conflict'], [`${D}/classes/Same.cls`, 'update']]);
    expect(plan.missing).toEqual(['ApexClass:Gone']);
    expect(await service.apply(root, second.jobId, {})).toMatchObject({ written: 1, kept: 1 });
    expect(read(root, `${D}/classes/Same.cls`)).toBe('class Same { v2 }');
    expect(read(root, `${D}/classes/Edited.cls`)).toBe('class Edited { mine }');
    // The kept edit is now ahead of the org copy that was recorded.
    expect((await service.check(root, 'apex')).components.map(component => component.key)).not.toContain('ApexClass:Edited');
  });

  it('skips files edited after review and keeps the rest of the component unrecorded', async () => {
    const { service, root, stored } = fixture();
    const { jobId } = await service.start(root, { components: ['ApexClass:Fresh'] });
    await settle(service, root, jobId);
    put(root, `${D}/classes/Fresh.cls`, 'typed meanwhile');
    const applied = await service.apply(root, jobId, {});
    expect(applied).toMatchObject({ written: 1, skipped: [{ path: `${D}/classes/Fresh.cls`, reason: 'Changed after review' }] });
    expect(read(root, `${D}/classes/Fresh.cls`)).toBe('typed meanwhile');
    expect(stored.get(`sf:project:p:sync::ApexClass`)).toBeUndefined();
  });

  it('checks one agent with its newest org version, the Apex, Flows and prompt templates it calls, and its Lightning types', async () => {
    const { service, root, query, execSf, dates, files } = fixture();
    put(root, `${D}/aiAuthoringBundles/Support/Support.agent`, ['apex://Same', 'apex://Fresh', 'flow://Route', 'generatePromptResponse://Summarize', 'apex://Ghost', 'standardInvocableAction://sendEmail', 'apex://Same'].map(target => `target: "${target}"`).join('\n')
      + '\ncomplex_data_type_name: "c__Offer"\ncomplex_data_type_name: "lightning__textType"\ncomplex_data_type_name: "c__GhostType"');
    dates['LightningTypeBundle:Offer'] = '2026-01-02T00:00:00.000Z';
    files['lightningTypes/Offer/schema.json'] = '{}';
    dates['Flow:Route'] = '2026-01-03T00:00:00.000+0000';
    dates['GenAiPromptTemplate:Summarize'] = '2026-01-04T00:00:00.000Z';
    files['flows/Route.flow-meta.xml'] = '<Flow/>';
    files['genAiPromptTemplates/Summarize.genAiPromptTemplate-meta.xml'] = '<Template/>';
    const check = await service.checkAgent(root, 'Support');
    // Support_2 is another local version, so it stays out; Support_3 is the newest org version.
    expect(check.components.map(component => [component.key, component.state])).toEqual([
      ['AiAuthoringBundle:Support_3', 'new'], ['GenAiPromptTemplate:Summarize', 'new'], ['Flow:Route', 'new'], ['LightningTypeBundle:Offer', 'new'], ['ApexClass:Fresh', 'new'], ['ApexClass:Same', 'unknown'],
    ]);
    expect(check.agent).toEqual({ name: 'Support', current: [], missing: ['ApexClass:Ghost', 'LightningTypeBundle:GhostType'] });
    expect(execSf).toHaveBeenCalledWith(expect.arrayContaining(['--metadata-type', 'LightningTypeBundle']), expect.anything());
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM ApexClass WHERE NamespacePrefix = null AND Name IN ('Same', 'Fresh', 'Ghost')"), expect.objectContaining({ tooling: false }));
    expect(query).toHaveBeenCalledWith("SELECT ApiName, LastModifiedDate, LastModifiedBy FROM FlowDefinitionView WHERE NamespacePrefix = null AND ApiName IN ('Route') ORDER BY ApiName", expect.anything());
    expect(check.components.find(component => component.key === 'Flow:Route')).toMatchObject({ modifiedBy: 'Ada', modifiedAt: '2026-01-03T00:00:00.000Z' });

    const { jobId } = await service.start(root, { components: ['ApexClass:Same', 'Flow:Route', 'LightningTypeBundle:Offer'], orgId: org.orgId });
    const plan = await settle(service, root, jobId);
    expect(plan.state === 'ready' && plan.files.map(file => [file.path, file.action])).toEqual([
      [`${D}/flows/Route.flow-meta.xml`, 'create'], [`${D}/lightningTypes/Offer/schema.json`, 'create'], [`${D}/classes/Same.cls`, 'same'], [`${D}/classes/Same.cls-meta.xml`, 'same'],
    ]);
    await service.apply(root, jobId, {});
    expect(read(root, `${D}/flows/Route.flow-meta.xml`)).toBe('<Flow/>');
    expect(read(root, `${D}/lightningTypes/Offer/schema.json`)).toBe('{}');
    const again = await service.checkAgent(root, 'Support');
    expect(again.agent!.current.map(row => row.key)).toEqual(['ApexClass:Same', 'Flow:Route', 'LightningTypeBundle:Offer']);
    expect(again.agent!.missing).toEqual(['ApexClass:Ghost', 'LightningTypeBundle:GhostType']);
    expect(again.counts.current).toBe(3);
    expect((await service.check(root, 'all')).components.map(component => component.key)).toContain('GenAiPromptTemplate:Summarize');

    put(root, `${D}/aiAuthoringBundles/Bare/Bare.agent`, 'no actions');
    expect((await service.checkAgent(root, 'Bare')).agent).toEqual({ name: 'Bare', current: [], missing: [] });
    await expect(service.checkAgent(root, '../x')).rejects.toThrow('Choose an agent');
    await expect(service.checkAgent(root, 'Nope')).rejects.toThrow('not in this project');
  });

  it('validates selections, the org, concurrency and project ownership', async () => {
    const { service, root, execSf, connect } = fixture();
    for (const components of [[], ['Dashboard:Main'], ['ApexClass:../x'], ['ApexClass:A:B'], [7], 'ApexClass:A']) {
      await expect(service.start(root, { components })).rejects.toThrow(/Choose/);
    }
    await expect(service.start(root, { components: Array.from({ length: 5001 }, (_, index) => `ApexClass:C${index}`) })).rejects.toThrow('at most 5,000');
    await expect(service.start(root, { components: ['ApexClass:Same'], orgId: 'other' })).rejects.toThrow('org changed');
    expect(execSf).not.toHaveBeenCalled();
    const { jobId } = await service.start(root, { components: ['ApexClass:Same'] });
    await expect(service.start(root, { components: ['ApexClass:Same'] })).rejects.toThrow('already running');
    await expect(service.status(temp(), jobId)).rejects.toThrow('current project');
    await expect(service.status(root, 'missing')).rejects.toThrow('current project');
    await settle(service, root, jobId);
    await expect(service.check('  ', 'all')).rejects.toThrow('Open a Salesforce DX project');
    await expect(service.check(temp(), 'all')).rejects.toThrow('sfdx-project.json');
    expect(connect).toHaveBeenCalled();
  });

  it('cancels, reports CLI failures, and removes the temp project on every path', async () => {
    const { service, root, execSf } = fixture();
    let release!: () => void;
    let cwd = '';
    execSf.mockImplementationOnce(async (_args, options) => { cwd = options!.cwd!; await new Promise<void>(resolve => { release = resolve; }); return ok({ success: true, done: true }); });
    const cancelled = await service.start(root, { components: ['ApexClass:Same'] });
    await vi.waitFor(() => expect(cwd).not.toBe(''));
    await service.cancel(root, cancelled.jobId);
    release();
    expect(existsSync(cwd)).toBe(false);
    await expect(service.status(root, cancelled.jobId)).rejects.toThrow('unavailable');

    execSf.mockImplementationOnce(async (_args, options) => { cwd = options!.cwd!; return { code: 1, stdout: JSON.stringify({ status: 1, message: 'INVALID_SESSION' }), stderr: '' }; });
    const failed = await service.start(root, { components: ['ApexClass:Same'] });
    expect(await settle(service, root, failed.jobId)).toEqual({ state: 'failed', error: 'INVALID_SESSION' });
    expect(existsSync(cwd)).toBe(false);

    execSf.mockImplementationOnce(async () => ok({ success: false }));
    const unfinished = await service.start(root, { components: ['ApexClass:Same'] });
    expect(await settle(service, root, unfinished.jobId)).toMatchObject({ state: 'failed', error: expect.stringContaining('did not complete') });

    execSf.mockImplementationOnce(async () => ({ code: 0, stdout: 'not json', stderr: '' }));
    const garbled = await service.start(root, { components: ['ApexClass:Same'] });
    expect(await settle(service, root, garbled.jobId)).toMatchObject({ state: 'failed', error: expect.stringContaining('incomplete output') });
  });

  it('retrieves large fetches in parallel batches, each in its own temp project, and reports progress', async () => {
    const { service, root, execSf } = fixture();
    const keys = Array.from({ length: 1001 }, (_, index) => `ApexClass:Bulk${index}`);
    const cwds = new Set<string>();
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    execSf.mockImplementation(async (_args, options) => {
      cwds.add(options!.cwd!);
      peak = Math.max(peak, ++active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      return ok({ success: true, done: true, files: [] });
    });
    const { jobId } = await service.start(root, { components: keys });
    expect(await service.status(root, jobId)).toEqual({ state: 'running', phase: 'retrieve', done: 0, total: 1001 });
    await vi.waitFor(() => expect(releases.length).toBe(3));
    releases.shift()!();
    await vi.waitFor(async () => expect(await service.status(root, jobId)).toMatchObject({ done: 250 }));
    await vi.waitFor(async () => {
      releases.splice(0).forEach(release => release());
      expect((await service.status(root, jobId)).state).toBe('ready');
    });
    expect(await settle(service, root, jobId)).toMatchObject({ state: 'ready', missing: keys });
    expect(peak).toBe(3);
    expect(cwds.size).toBe(3);
    expect(execSf).toHaveBeenCalledTimes(5);
    for (const cwd of cwds) expect(existsSync(cwd)).toBe(true);
    await service.cancel(root, jobId);
    for (const cwd of cwds) expect(existsSync(cwd)).toBe(false);
  });

  it('stops the other batches and removes every temp project when one batch fails', async () => {
    const { service, root, execSf } = fixture();
    const keys = Array.from({ length: 600 }, (_, index) => `ApexClass:Bulk${index}`);
    const cwds = new Set<string>();
    const signals: AbortSignal[] = [];
    execSf.mockImplementation(async (_args, options) => {
      cwds.add(options!.cwd!);
      signals.push(options!.signal!);
      if (signals.length === 2) return { code: 1, stdout: JSON.stringify({ status: 1, message: 'REQUEST_LIMIT_EXCEEDED' }), stderr: '' };
      await new Promise<void>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason)));
      return ok({ success: true, done: true });
    });
    const { jobId } = await service.start(root, { components: keys });
    expect(await settle(service, root, jobId)).toEqual({ state: 'failed', error: 'REQUEST_LIMIT_EXCEEDED' });
    expect(signals[0]!.aborted).toBe(true);
    for (const cwd of cwds) expect(existsSync(cwd)).toBe(false);
  });

  it('expires unapplied plans and disposes running jobs', async () => {
    const { root, execSf, query, queryMore, connect, kv } = fixture();
    let now = 1_000;
    const service = new OrgSyncService({ execSf, query, queryMore, connect, kv, key: name => name, now: () => now });
    services.push(service);
    const { jobId } = await service.start(root, { components: ['ApexClass:Same'] });
    await settle(service, root, jobId);
    now += 16 * 60_000;
    await expect(service.status(root, jobId)).rejects.toThrow('unavailable');
    service.dispose();
    await expect(service.start(root, { components: ['ApexClass:Same'] })).rejects.toThrow('restarting');
  });

  it('pages SOQL, ignores managed and malformed rows, and refuses package directories outside the project', async () => {
    const { service, root, query, queryMore } = fixture();
    query.mockImplementationOnce(async () => ({ done: false, nextRecordsUrl: '/next', records: [{ Name: 'Same', LastModifiedDate: 'bad' }, { Name: '../x' }] }));
    queryMore.mockImplementationOnce(async () => ({ done: true, records: [{ Name: 'Edited', LastModifiedDate: '2026-01-01T00:00:00.000Z', LastModifiedBy: null }] }));
    const check = await service.check(root, 'apex');
    expect(queryMore).toHaveBeenCalledWith('/next', expect.anything());
    expect(check.components.filter(component => component.type === 'ApexClass').map(component => [component.fullName, component.modifiedAt, component.modifiedBy])).toEqual([['Edited', '2026-01-01T00:00:00.000Z', null], ['Same', null, null]]);
    expect((await service.check(root, 'agentforce')).components.map(component => component.fullName)).not.toContain('Managed_1');

    const outside = temp();
    put(root, 'sfdx-project.json', JSON.stringify({ packageDirectories: [{ path: 'linked', default: true }] }));
    symlinkSync(outside, join(root, 'linked'));
    await expect(service.check(root, 'apex')).rejects.toThrow('outside this project');
  });

  it('treats a symlinked local file as a conflict and refuses to write through it', async () => {
    const { service, root } = fixture();
    const outside = temp();
    put(outside, 'target.cls', 'outside');
    rmSync(join(root, D, 'classes', 'Same.cls'));
    symlinkSync(join(outside, 'target.cls'), join(root, D, 'classes', 'Same.cls'));
    const { jobId } = await service.start(root, { components: ['ApexClass:Same'] });
    const plan = await settle(service, root, jobId);
    if (plan.state !== 'ready') throw Error(plan.state);
    expect(plan.files.find(file => file.path.endsWith('Same.cls'))!.action).toBe('conflict');
    const applied = await service.apply(root, jobId, { take: [`${D}/classes/Same.cls`] });
    expect(applied).toMatchObject({ written: 0, skipped: [{ reason: expect.stringContaining('symbolic link') }] });
    expect(read(outside, 'target.cls')).toBe('outside');
  });
});

describe('fetch latest RPCs', () => {
  it('validates scope, resolves the project root per call and announces written files', async () => {
    const handlers = new Map<string, (args: unknown) => unknown>();
    const service = {
      check: vi.fn(async () => ({ components: [] })),
      checkAgent: vi.fn(async () => ({ components: [], agent: { name: 'Support' } })),
      start: vi.fn(async () => ({ jobId: 'j' })),
      status: vi.fn(async () => ({ state: 'running' })),
      diff: vi.fn(async () => ({ path: 'p' })),
      apply: vi.fn(async (_root: string, _job: string, args: { written?: number }) => ({ state: 'applied', written: args.written ?? 0, kept: 0, skipped: [] })),
      cancel: vi.fn(async () => {}),
    };
    const changed = vi.fn();
    registerOrgSync({ registerRpc: (name, handler) => handlers.set(name, handler), service: service as never, projectRoot: async () => '/project', changed });
    const call = (name: string, args: unknown) => handlers.get(name)!(args);
    expect(await call('sync.check', {})).toEqual({ ok: true, data: { components: [], truncated: false } });
    expect(service.check).toHaveBeenCalledWith('/project', 'all');
    expect(await call('sync.check', { agent: 'Support' })).toEqual({ ok: true, data: { components: [], agent: { name: 'Support' }, truncated: false } });
    expect(service.checkAgent).toHaveBeenCalledWith('/project', 'Support');
    await expect(call('sync.check', { scope: 'flows' })).rejects.toThrow('Choose agentforce');
    const rows = [{ key: 'a', state: 'new' }, { key: 'b', state: 'changed' }, { key: 'c', state: 'changed' }];
    service.check.mockResolvedValue({ components: rows, truncated: false } as never);
    expect(await call('sync.check', { states: ['changed'], limit: 1 })).toEqual({ ok: true, data: { components: [rows[1]], truncated: true } });
    expect(await call('sync.check', { states: ['changed'] })).toEqual({ ok: true, data: { components: rows.slice(1), truncated: false } });
    expect(await call('sync.check', { limit: 5 })).toEqual({ ok: true, data: { components: rows, truncated: false } });
    service.check.mockResolvedValue({ components: rows, current: [{ key: 'd' }], truncated: false } as never);
    expect(await call('sync.check', {})).toEqual({ ok: true, data: { components: rows, truncated: false } });
    expect(await call('sync.check', { current: true })).toEqual({ ok: true, data: { components: rows, current: [{ key: 'd' }], truncated: false } });
    await expect(call('sync.check', { states: ['stale'] })).rejects.toThrow('Choose states from changed');
    await expect(call('sync.check', { limit: 0 })).rejects.toThrow('positive whole-number');
    await expect(call('sync.check', { limit: 'x' })).rejects.toThrow('positive whole-number');
    expect(await call('sync.fetch.start', { components: [] })).toEqual({ ok: true, jobId: 'j' });
    expect(await call('sync.fetch.status', { jobId: 'j' })).toEqual({ ok: true, data: { state: 'running' } });
    expect(service.status).toHaveBeenCalledWith('/project', 'j');
    expect(await call('sync.diff', { jobId: 'j', path: 'p' })).toEqual({ ok: true, data: { path: 'p' } });
    await call('sync.apply', { jobId: 'j' });
    expect(changed).not.toHaveBeenCalled();
    await call('sync.apply', { jobId: 'j', written: 2 });
    expect(changed).toHaveBeenCalledOnce();
    changed.mockImplementation(() => { throw Error('no listeners'); });
    expect(await call('sync.apply', { jobId: 'j', written: 1 })).toMatchObject({ ok: true, data: { state: 'applied', written: 1 } });
    expect(await call('sync.cancel', { jobId: 7 })).toEqual({ ok: true });
    expect(service.cancel).toHaveBeenCalledWith('/project', '');
  });
});
