import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { sha256Hex } from '../lib/agent-files.js';
import { createSalesforcePlugin } from '../lib/plugin.js';
import {
  parseVersions,
  publishRecordKey,
  ReadGrants,
  clickedSdk,
  releaseBinding,
  releaseRequest,
  versionsSoql,
  withApprovedEnvelope
} from '../lib/release.js';
import { RELEASE_READ_GRANT_MS, RELEASE_RPC, type ReleaseApprovalRequest, type ReleaseState } from '../lib/release-contract.js';
import { STUDIO_RPC } from '../lib/studio-contract.js';
import { suitePathForAgent } from '../lib/scenario-suites.js';
import type { SalesforceSdk } from '../lib/sdk-contract.js';
import type { SalesforceDeps, SalesforceRequest } from '../lib/types.js';

const ORG_ID = '00Dxx0000000001';
const BOT = '/proj/force-app/main/default/agents/MyBot.agent';
const PATH = 'force-app/main/default/agents/MyBot.agent';
const SOURCE = 'config {\n  name: "MyBot"\n}\nstart_agent {\n}\n';
const sandbox = { alias: 'dev', orgId: ORG_ID, kind: 'sandbox' as const };
const production = { alias: 'prod', orgId: ORG_ID, kind: 'production' as const };

type Row = { Id: string; Status: string; VersionNumber: number; LastModifiedDate?: string };
const VERSIONS: Row[] = [
  { Id: '0X9a', Status: 'Active', VersionNumber: 1, LastModifiedDate: '2026-10-01T10:00:00.000Z' },
  { Id: '0X9b', Status: 'Inactive', VersionNumber: 2, LastModifiedDate: '2026-10-10T10:00:00.000Z' }
];

/** Org authoring bundles by full name; `target` is the BotVersion the bundle published. */
type Bundles = Record<string, { target?: string; content: string }>;
type FakeState = { versions: Row[]; queryStatus?: number; queryThrows?: boolean; bundles?: Bundles; retrievedIn?: string };

function fakeDeps(kind: 'sandbox' | 'production', state: FakeState) {
  const files: Record<string, string> = {
    '/proj/sfdx-project.json': '{"packageDirectories":[{"path":"force-app"}]}',
    [BOT]: SOURCE
  };
  const dirs: Record<string, string[]> = {
    '/proj': ['sfdx-project.json', 'force-app'],
    '/proj/force-app': ['main'],
    '/proj/force-app/main': ['default'],
    '/proj/force-app/main/default': ['agents'],
    '/proj/force-app/main/default/agents': ['MyBot.agent']
  };
  const sf: string[][] = [];
  const queries: string[] = [];
  const deps: SalesforceDeps = {
    execSf: async (args, options) => {
      if (args[0] === '--version') return { code: 0, stdout: '@salesforce/cli/2.0.0\n', stderr: '' };
      if (args.includes('display')) {
        return {
          code: 0,
          stdout: JSON.stringify({
            result: {
              alias: 'dev', username: 'dev@example.com', orgId: ORG_ID, accessToken: 'SECRET', apiVersion: '62.0',
              instanceUrl: kind === 'sandbox' ? 'https://foo--dev.sandbox.my.salesforce.com' : 'https://org.my.salesforce.com',
              isSandbox: kind === 'sandbox', isScratchOrg: false
            }
          }),
          stderr: ''
        };
      }
      if (args[0] === 'agent' && args[1] === '--help') return { code: 0, stdout: 'validate preview publish activate\n', stderr: '' };
      sf.push(args);
      if (args[0] === 'agent' && args[1] === 'validate') return { code: 0, stdout: JSON.stringify({ status: 0, result: { success: true } }), stderr: '' };
      if (args[0] === 'agent') return { code: 0, stdout: JSON.stringify({ status: 0, result: { success: true } }), stderr: '' };
      if (args[0] === 'org' && args[1] === 'open') return { code: 0, stdout: JSON.stringify({ status: 0, result: {} }), stderr: '' };
      if (args[0] === 'org' && args[2] === 'metadata') {
        return { code: 0, stdout: JSON.stringify({ status: 0, result: Object.keys(state.bundles ?? {}).map(fullName => ({ fullName })) }), stderr: '' };
      }
      if (args[0] === 'project' && args[1] === 'retrieve') {
        state.retrievedIn = options!.cwd!;
        for (const [index, flag] of args.entries()) {
          if (flag !== '--metadata') continue;
          const fullName = args[index + 1]!.replace('AiAuthoringBundle:', '');
          const bundle = state.bundles?.[fullName];
          if (!bundle) continue;
          const folder = join(options!.cwd!, 'force-app/main/default/aiAuthoringBundles', fullName);
          mkdirSync(folder, { recursive: true });
          writeFileSync(join(folder, `${fullName}.agent`), bundle.content);
          writeFileSync(join(folder, `${fullName}.bundle-meta.xml`), `<AiAuthoringBundle>${bundle.target ? `<target>${bundle.target}</target>` : ''}</AiAuthoringBundle>`);
        }
        return { code: 0, stdout: JSON.stringify({ status: 0, result: { success: true, done: true } }), stderr: '' };
      }
      return { code: 1, stdout: '', stderr: 'unexpected' };
    },
    request: async (_org, req: SalesforceRequest) => {
      if (req.path === '/query') {
        queries.push(String(req.query?.q ?? ''));
        if (state.queryThrows) throw new Error('Connection reset');
        if (state.queryStatus) return { status: state.queryStatus, json: [{ message: 'nope' }], text: 'nope' };
        return { status: 200, json: { records: state.versions }, text: '{}' };
      }
      return { status: 404, json: null, text: '' };
    },
    now: () => Date.now(),
    exists: (path) => path in files || path in dirs,
    stat: (path) => (path in dirs ? 'dir' : path in files ? 'file' : 'missing'),
    readFile: (path) => files[path] ?? null,
    readdir: (path) => dirs[path] ?? [],
    realpath: (path) => path,
    spawnContained: async () => ({ code: 0, stdout: '', stderr: '' }),
    writeFile: (path, content) => { files[path] = content; }
  };
  return { deps, files, dirs, sf, queries };
}

async function setup(kind: 'sandbox' | 'production' = 'sandbox', versions: Row[] = VERSIONS) {
  const state: FakeState = { versions };
  const { zcc, harness } = createFakePluginHost({ pluginId: 'salesforce', listProjects: async () => [{ id: 'p1', name: 'DX', path: '/proj' }] });
  const fake = fakeDeps(kind, state);
  await createSalesforcePlugin(zcc, fake.deps);
  harness.setSettings({ defaultOrg: 'dev', projectRoot: '/proj' });
  const call = (name: string, args: Record<string, unknown> = {}) => harness.callRpc(name, { path: PATH, ...args }) as Promise<any>;
  const prepare = async (args: Record<string, unknown>) => {
    const prepared = await call(RELEASE_RPC.prepare, args);
    expect(prepared).toMatchObject({ ok: true });
    return prepared.data.request as ReleaseApprovalRequest;
  };
  const approveAndRun = async (args: Record<string, unknown>) => {
    const request = await prepare(args);
    return call(RELEASE_RPC.run, { ...args, token: harness.approve(request.binding) });
  };
  const evidence = (botVersionId: string, passed = true) =>
    zcc.storage.kv.set(`eval-evidence:${ORG_ID}:${botVersionId}`, { orgId: ORG_ID, botVersionId, specFingerprint: 'f', passed, at: Date.parse('2026-10-11T00:00:00Z') });
  return { harness, zcc, state, ...fake, call, prepare, approveAndRun, evidence };
}

describe('release helpers', () => {
  it('builds a bounded versions query only for a real API name', () => {
    expect(versionsSoql('My_Bot2')).toBe("SELECT Id, Status, VersionNumber, LastModifiedDate FROM BotVersion WHERE BotDefinition.DeveloperName = 'My_Bot2' ORDER BY VersionNumber DESC LIMIT 25");
    for (const name of ["x' OR Id != '", '1Bot', '', 'a'.repeat(81)]) expect(() => versionsSoql(name)).toThrow('Invalid Agentforce API name');
  });

  it('parses version rows newest first and skips what it cannot read', () => {
    expect(parseVersions(null)).toEqual([]);
    expect(parseVersions([
      null, 'x', { Id: '', VersionNumber: 1 }, { Id: 'a', VersionNumber: 'two' },
      { Id: 'old', Status: 'Inactive', VersionNumber: '1' },
      { Id: 'new', Status: 'Active', VersionNumber: 3, LastModifiedDate: '2026-10-11' }
    ])).toEqual([
      { id: 'new', versionNumber: 3, active: true, modifiedAt: '2026-10-11' },
      { id: 'old', versionNumber: 1, active: false, modifiedAt: null }
    ]);
  });

  it('binds the action, org, subject and revision, and asks production for the alias', () => {
    expect(releaseBinding({ action: 'agent.publish', org: sandbox, apiName: 'MyBot', revision: 'abc' })).toEqual({
      action: 'agent.publish', target: ORG_ID, targetLabel: 'dev (sandbox)', subject: 'MyBot', revision: 'abc'
    });
    expect(releaseBinding({ action: 'agent.activate', org: production, apiName: 'MyBot', revision: '0X9b', versionNumber: 2 })).toEqual({
      action: 'agent.activate', target: ORG_ID, targetLabel: 'prod (production)', subject: 'MyBot v2', revision: '0X9b', confirmText: 'prod'
    });
    expect(releaseBinding({ action: 'org.read', org: { ...production, kind: 'unknown' }, apiName: 'MyBot' })).toEqual({
      action: 'org.read', target: ORG_ID, targetLabel: 'prod (unknown)', subject: 'MyBot versions'
    });
  });

  it('explains each sheet and paints risky ones red', () => {
    const binding = releaseBinding({ action: 'agent.publish', org: sandbox, apiName: 'MyBot' });
    expect(releaseRequest(binding, { org: sandbox, apiName: 'MyBot' })).toMatchObject({ title: 'Publish MyBot', confirmLabel: 'Publish', tone: 'default' });
    expect(releaseRequest(binding, { org: production, apiName: 'MyBot' }).tone).toBe('danger');
    const activate = { ...binding, action: 'agent.activate' };
    const at = Date.parse('2026-10-11T08:00:00Z');
    expect(releaseRequest(activate, { org: sandbox, apiName: 'MyBot', versionNumber: 2 })).toMatchObject({
      title: 'Activate MyBot v2', details: ['No eval evidence for this version. Activating it is untested.']
    });
    expect(releaseRequest(activate, { org: production, apiName: 'MyBot', versionNumber: 2, evidence: { passed: true, at } })).toMatchObject({
      details: ['Eval passed for this version on 2026-10-11.'], tone: 'danger'
    });
    expect(releaseRequest(activate, { org: sandbox, apiName: 'MyBot', versionNumber: 2, evidence: { passed: false, at } }).details?.[0]).toContain('failed on 2026-10-11');
    expect(releaseRequest({ ...binding, action: 'agent.deactivate' }, { org: sandbox, apiName: 'MyBot' })).toMatchObject({ title: 'Deactivate MyBot', tone: 'danger' });
    const read = releaseRequest({ ...binding, action: 'org.read' }, { org: production, apiName: 'MyBot' });
    expect(read).toMatchObject({ title: 'Read MyBot versions', confirmLabel: 'Allow' });
    expect(read.summary).toContain('30 minutes');
    expect(read.tone).toBeUndefined();
  });
});

function baseSdk(): SalesforceSdk & { confirm: ReturnType<typeof vi.fn> } {
  return { confirm: vi.fn(async () => ({ approved: false, reason: 'headless' })) } as never;
}
const envelope = (kind: string | undefined, orgId = ORG_ID, orgKind: 'production' | 'sandbox' | 'unknown' = 'production') =>
  ({ kind: kind as never, orgId, orgAlias: 'prod', orgKind, summary: 's' });

describe('approved envelopes', () => {
  it('approves the one envelope the sheet covered, once', async () => {
    const base = baseSdk();
    const sdk = withApprovedEnvelope(base, { kind: 'agent.activate', orgId: ORG_ID });
    await expect(sdk.confirm(envelope('agent.publish'), '')).resolves.toMatchObject({ approved: false });
    await expect(sdk.confirm(envelope('agent.activate', 'other'), '')).resolves.toMatchObject({ approved: false });
    await expect(sdk.confirm(envelope('agent.activate'), '')).resolves.toEqual({ approved: true, reason: 'submitted' });
    await expect(sdk.confirm(envelope('agent.activate'), '')).resolves.toMatchObject({ approved: false });
    expect(base.confirm).toHaveBeenCalledTimes(3);
  });

  it('lets a clicked Studio button pass an org read, never publish or Live', async () => {
    const base = baseSdk();
    expect(clickedSdk(base, { startedByUser: 'yes' })).toBe(base);
    expect(clickedSdk(base, null)).toBe(base);
    const sdk = clickedSdk(base, { startedByUser: true });
    await expect(sdk.confirm(envelope(undefined), '')).resolves.toEqual({ approved: true, reason: 'submitted' });
    await expect(sdk.confirm(envelope('org.production.read'), '')).resolves.toEqual({ approved: true, reason: 'submitted' });
    await expect(sdk.confirm(envelope('agent.publish'), '')).resolves.toMatchObject({ approved: false });
    await expect(sdk.confirm(envelope('agent.preview.live'), '')).resolves.toMatchObject({ approved: false });
    await expect(sdk.confirm(envelope('org.unknown.read', ORG_ID, 'production'), '')).resolves.toMatchObject({ approved: false });
    expect(base.confirm).toHaveBeenCalledTimes(3);
  });

  it('keeps read grants per project and org until they expire, within a cap', async () => {
    let now = 1_000;
    const grants = new ReadGrants(() => now);
    expect(grants.until('p1', ORG_ID)).toBeNull();
    expect(grants.grant('p1', ORG_ID)).toBe(1_000 + RELEASE_READ_GRANT_MS);
    expect(grants.until('p1', ORG_ID)).toBe(1_000 + RELEASE_READ_GRANT_MS);
    expect(grants.until('p2', ORG_ID)).toBeNull();
    const base = baseSdk();
    const sdk = grants.wrap(base, 'p1');
    await expect(sdk.confirm(envelope(undefined), '')).resolves.toEqual({ approved: true, reason: 'submitted' });
    await expect(sdk.confirm(envelope('org.production.read'), '')).resolves.toEqual({ approved: true, reason: 'submitted' });
    await expect(sdk.confirm(envelope('org.unknown.read', ORG_ID, 'production'), '')).resolves.toMatchObject({ approved: false });
    await expect(sdk.confirm(envelope('agent.publish'), '')).resolves.toMatchObject({ approved: false });
    await expect(sdk.confirm(envelope(undefined, 'other'), '')).resolves.toMatchObject({ approved: false });
    await expect(sdk.confirm(envelope(undefined, ORG_ID, 'sandbox'), '')).resolves.toMatchObject({ approved: false });
    await expect(grants.wrap(base, 'p2').confirm(envelope(undefined), '')).resolves.toMatchObject({ approved: false });
    now += RELEASE_READ_GRANT_MS;
    expect(grants.until('p1', ORG_ID)).toBeNull();
    for (let i = 0; i < 70; i += 1) grants.grant('p1', `org-${i}`);
    expect(grants.until('p1', 'org-0')).toBeNull();
    expect(grants.until('p1', 'org-69')).not.toBeNull();
    grants.grant('p1', 'org-10');
    expect(grants.until('p1', 'org-10')).not.toBeNull();
  });
});

describe('release RPCs on a sandbox', () => {
  it('reads the lane, publishes the approved source and records it', async () => {
    const { call, approveAndRun, sf, queries, evidence, harness } = await setup();
    await evidence('0X9b');
    const first = await call(RELEASE_RPC.state);
    expect(first).toEqual({
      ok: true,
      data: {
        org: { alias: 'dev', orgId: ORG_ID, kind: 'sandbox' },
        agent: { apiName: 'MyBot', path: PATH, revision: sha256Hex(SOURCE), versioned: false, lastPublish: null },
        readUntil: null,
        needsReadApproval: false,
        versions: [
          { id: '0X9b', versionNumber: 2, active: false, modifiedAt: '2026-10-10T10:00:00.000Z', evidence: { passed: true, at: Date.parse('2026-10-11T00:00:00Z') } },
          { id: '0X9a', versionNumber: 1, active: true, modifiedAt: '2026-10-01T10:00:00.000Z', evidence: null }
        ]
      }
    });
    expect(queries[0]).toContain("DeveloperName = 'MyBot'");
    const published = await approveAndRun({ action: 'agent.publish' });
    expect(published).toMatchObject({ ok: true, summary: 'Published inactive version of MyBot' });
    expect(sf.at(-1)).toEqual(expect.arrayContaining(['agent', 'publish', '--api-name', 'MyBot', '--target-org', 'dev']));
    const after = await call(RELEASE_RPC.state);
    expect(after.data.agent.lastPublish).toEqual({ revision: sha256Hex(SOURCE), at: expect.any(Number) });
    // Without a token, or with another action's token, nothing runs.
    const runs = sf.length;
    await expect(call(RELEASE_RPC.run, { action: 'agent.publish' })).resolves.toMatchObject({ ok: false, code: 'approval_invalid' });
    const request = (await call(RELEASE_RPC.prepare, { action: 'agent.deactivate' })).data.request as ReleaseApprovalRequest;
    await expect(call(RELEASE_RPC.run, { action: 'agent.publish', token: harness.approve(request.binding) })).resolves.toMatchObject({ code: 'approval_invalid' });
    expect(sf.length).toBe(runs);
  });

  it('refuses a token once the source changed or it was used', async () => {
    const { call, prepare, files, sf, harness } = await setup();
    const request = await prepare({ action: 'agent.publish' });
    const token = harness.approve(request.binding);
    files[BOT] = `${SOURCE}# edited\n`;
    await expect(call(RELEASE_RPC.run, { action: 'agent.publish', token })).resolves.toMatchObject({ ok: false, code: 'approval_invalid' });
    expect(sf.some(args => args[1] === 'publish')).toBe(false);
    const fresh = await prepare({ action: 'agent.publish' });
    const again = harness.approve(fresh.binding);
    await expect(call(RELEASE_RPC.run, { action: 'agent.publish', token: again })).resolves.toMatchObject({ ok: true });
    await expect(call(RELEASE_RPC.run, { action: 'agent.publish', token: again })).resolves.toMatchObject({ code: 'approval_invalid' });
  });

  it('activates a picked version, untested on a sandbox, and deactivates the live one', async () => {
    const { prepare, approveAndRun, sf } = await setup();
    const request = await prepare({ action: 'agent.activate', versionNumber: 2 });
    expect(request.binding).toEqual({ action: 'agent.activate', target: ORG_ID, targetLabel: 'dev (sandbox)', subject: 'MyBot v2', revision: '0X9b' });
    expect(request.details?.[0]).toContain('untested');
    await expect(approveAndRun({ action: 'agent.activate', versionNumber: 2 })).resolves.toMatchObject({ ok: true, summary: 'Activated MyBot' });
    expect(sf.at(-1)).toEqual(['agent', 'activate', '--json', '--api-name', 'MyBot', '--target-org', 'dev', '--version', '2']);
    await expect(approveAndRun({ action: 'agent.deactivate' })).resolves.toMatchObject({ ok: true, summary: 'Deactivated MyBot' });
    expect(sf.at(-1)).toEqual(['agent', 'deactivate', '--json', '--api-name', 'MyBot', '--target-org', 'dev']);
  });

  it('says why it cannot prepare', async () => {
    const { call, state, files, dirs } = await setup();
    const prepare = (args: Record<string, unknown>) => call(RELEASE_RPC.prepare, args);
    await expect(call(RELEASE_RPC.state, { path: '' })).resolves.toMatchObject({ code: 'invalid_input' });
    await expect(call(RELEASE_RPC.state, { path: 'force-app/main/default/agents/Missing.agent' })).resolves.toMatchObject({ code: 'not_found' });
    await expect(call(RELEASE_RPC.state, { path: '../etc/passwd' })).resolves.toMatchObject({ ok: false, code: 'path_refused' });
    await expect(prepare({ action: 'agent.delete' })).resolves.toMatchObject({ code: 'invalid_input' });
    await expect(prepare({ action: 'org.read' })).resolves.toMatchObject({ code: 'not_needed' });
    await expect(prepare({ action: 'agent.activate' })).resolves.toMatchObject({ code: 'not_found' });
    await expect(prepare({ action: 'agent.activate', versionNumber: 9 })).resolves.toMatchObject({ code: 'not_found' });
    await expect(prepare({ action: 'agent.activate', versionNumber: 1 })).resolves.toMatchObject({ code: 'already_active' });
    state.versions = [{ Id: '0X9b', Status: 'Inactive', VersionNumber: 2 }];
    await expect(prepare({ action: 'agent.deactivate' })).resolves.toMatchObject({ code: 'no_active_version' });
    state.queryStatus = 500;
    await expect(call(RELEASE_RPC.state)).resolves.toMatchObject({ ok: true, data: { versions: [], versionsError: expect.stringContaining('nope') } });
    await expect(prepare({ action: 'agent.deactivate' })).resolves.toMatchObject({ code: 'api_error' });
    files['/proj/force-app/main/default/agents/MyBot.bundle-meta.xml'] = '<Bot><target>MyBot.v2</target></Bot>';
    dirs['/proj/force-app/main/default/agents']!.push('MyBot.bundle-meta.xml');
    await expect(prepare({ action: 'agent.publish' })).resolves.toMatchObject({ code: 'versioned_source' });
  });

  it('keeps publishing available when reading versions fails, and recovers on refresh', async () => {
    const { call, state, approveAndRun, sf } = await setup();
    for (const failure of ['http', 'network']) {
      state.queryStatus = failure === 'http' ? 400 : undefined;
      state.queryThrows = failure === 'network';
      await expect(call(RELEASE_RPC.state)).resolves.toMatchObject({
        ok: true, data: { agent: { apiName: 'MyBot' }, org: { alias: 'dev' }, versions: [], versionsError: expect.stringContaining('Could not read MyBot versions') }
      });
      await expect(approveAndRun({ action: 'agent.publish' })).resolves.toMatchObject({ ok: true });
      await expect(call(RELEASE_RPC.prepare, { action: 'agent.activate', versionNumber: 2 })).resolves.toMatchObject({ code: 'api_error' });
    }
    expect(sf.filter(args => args[1] === 'publish')).toHaveLength(2);
    state.queryStatus = undefined;
    state.queryThrows = false;
    const recovered = await call(RELEASE_RPC.state);
    expect(recovered.data.versions).toHaveLength(2);
    expect(recovered.data.versionsError).toBeUndefined();
  });

  it('uses the data API for agent tool version lists too', async () => {
    const { harness, queries } = await setup();
    const agent = harness.agentTools.find(tool => tool.name === 'sf_agent')!;
    await expect(agent.execute({ action: 'lifecycle.list' }, { threadId: 't1', projectId: 'p1' } as never)).resolves.toMatchObject({
      ok: true, data: { records: VERSIONS }
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('FROM BotVersion');
  });
});

describe('opening a version read-only', () => {
  const BUNDLES: Bundles = {
    MyBot: { content: 'draft in the org' },
    MyBot_v1: { target: 'MyBot.v1', content: 'version one' },
    MyBot_v2: { target: 'MyBot.v2', content: 'version two' },
    Other_v1: { target: 'Other.v1', content: 'someone else' }
  };

  it("reads the bundle that published the version into a temp folder and never touches the project", async () => {
    const { call, state, sf, files } = await setup();
    state.bundles = BUNDLES;
    const before = { ...files };
    await expect(call(RELEASE_RPC.versionSource, { versionNumber: 1 })).resolves.toEqual({
      ok: true,
      data: { apiName: 'MyBot', versionNumber: 1, active: true, fullName: 'MyBot_v1', content: 'version one' }
    });
    expect(sf.at(-1)).toEqual(['project', 'retrieve', 'start', '--metadata', 'AiAuthoringBundle:MyBot_v2', '--metadata', 'AiAuthoringBundle:MyBot_v1',
      '--metadata', 'AiAuthoringBundle:MyBot', '--target-org', 'dev', '--json', '--wait', '2']);
    expect(existsSync(state.retrievedIn!)).toBe(false);
    expect(files).toEqual(before);
    await expect(call(RELEASE_RPC.versionSource, { versionNumber: 2 })).resolves.toMatchObject({ data: { active: false, fullName: 'MyBot_v2', content: 'version two' } });
  });

  it('says why a version cannot open', async () => {
    const { call, state, sf } = await setup();
    for (const versionNumber of [undefined, 0, 1.5, '1', -2]) {
      await expect(call(RELEASE_RPC.versionSource, { versionNumber })).resolves.toMatchObject({ ok: false, code: 'invalid_input' });
    }
    await expect(call(RELEASE_RPC.versionSource, { path: '', versionNumber: 1 })).resolves.toMatchObject({ code: 'invalid_input' });
    await expect(call(RELEASE_RPC.versionSource, { versionNumber: 9 })).resolves.toMatchObject({ code: 'not_found', error: 'MyBot v9 does not exist on dev.' });
    expect(sf).toEqual([]);
    state.bundles = {};
    await expect(call(RELEASE_RPC.versionSource, { versionNumber: 1 })).resolves.toMatchObject({ code: 'version_unavailable', error: expect.stringContaining('no authoring bundle on dev') });
    state.bundles = { MyBot: BUNDLES.MyBot!, MyBot_v2: BUNDLES.MyBot_v2! };
    await expect(call(RELEASE_RPC.versionSource, { versionNumber: 1 })).resolves.toMatchObject({
      code: 'version_unavailable', error: expect.stringContaining('None of the 2 newest MyBot authoring bundles on dev published v1.')
    });
    state.queryStatus = 500;
    await expect(call(RELEASE_RPC.versionSource, { versionNumber: 1 })).resolves.toMatchObject({ code: 'api_error' });
  });

  it('needs the read approval on production before it reads the org', async () => {
    const { call, approveAndRun, state, sf, queries } = await setup('production');
    state.bundles = BUNDLES;
    await expect(call(RELEASE_RPC.versionSource, { versionNumber: 1 })).resolves.toMatchObject({ ok: false, code: 'read_required' });
    expect(sf).toEqual([]);
    expect(queries).toEqual([]);
    await approveAndRun({ action: 'org.read' });
    await expect(call(RELEASE_RPC.versionSource, { versionNumber: 1 })).resolves.toMatchObject({ ok: true, data: { content: 'version one' } });
  });
});

describe('release RPCs on production', () => {
  it('reads versions only after a read approval, which also opens Compile', async () => {
    const { call, approveAndRun, prepare, queries } = await setup('production');
    const locked = await call(RELEASE_RPC.state);
    expect(locked.data).toMatchObject({ needsReadApproval: true, readUntil: null, versions: [] });
    expect(queries).toEqual([]);
    await expect(call(RELEASE_RPC.prepare, { action: 'agent.activate', versionNumber: 2 })).resolves.toMatchObject({ code: 'read_required' });
    await expect(call('agentScript.compile', { path: PATH })).resolves.toMatchObject({ ok: false, code: 'refused' });
    // A click on Compile is its own approval, so it reads without asking anywhere.
    await expect(call('agentScript.compile', { path: PATH, startedByUser: true })).resolves.toMatchObject({ ok: true });
    // So is a click on Open in Builder.
    await expect(call('agentBuilder.open', { path: PATH })).resolves.toMatchObject({ ok: false, code: 'refused' });
    await expect(call('agentBuilder.open', { path: PATH, startedByUser: true })).resolves.toMatchObject({ ok: true });
    const read = await prepare({ action: 'org.read' });
    expect(read.binding).toEqual({ action: 'org.read', target: ORG_ID, targetLabel: 'dev (production)', subject: 'MyBot versions' });
    await expect(approveAndRun({ action: 'org.read' })).resolves.toMatchObject({ ok: true, data: { readUntil: expect.any(Number) } });
    const open = await call(RELEASE_RPC.state);
    expect(open.data).toMatchObject({ needsReadApproval: false, readUntil: expect.any(Number) });
    expect(open.data.versions).toHaveLength(2);
    await expect(call('agentScript.compile', { path: PATH })).resolves.toMatchObject({ ok: true });
  });

  it('needs typed alias and passing eval evidence to activate', async () => {
    const { call, approveAndRun, prepare, evidence, sf } = await setup('production');
    await approveAndRun({ action: 'org.read' });
    await evidence('2', false);
    await expect(call(RELEASE_RPC.prepare, { action: 'agent.activate', versionNumber: 2 })).resolves.toMatchObject({ code: 'eval_required' });
    await evidence('2', true);
    const request = await prepare({ action: 'agent.activate', versionNumber: 2 });
    expect(request).toMatchObject({ binding: { confirmText: 'dev', revision: '0X9b' }, tone: 'danger', details: ['Eval passed for this version on 2026-10-11.'] });
    await expect(approveAndRun({ action: 'agent.activate', versionNumber: 2 })).resolves.toMatchObject({ ok: true });
    expect(sf.at(-1)).toEqual(['agent', 'activate', '--json', '--api-name', 'MyBot', '--target-org', 'dev', '--version', '2']);
    const publish = await prepare({ action: 'agent.publish' });
    expect(publish.binding.confirmText).toBe('dev');
  });

  it('never lets an approved run pass the thread gate for anything else', async () => {
    const { zcc, harness, call } = await setup('production');
    const publishKey = publishRecordKey(ORG_ID, 'MyBot');
    expect(await zcc.storage.kv.get(publishKey)).toBeUndefined();
    const consume = vi.spyOn(zcc.ui, 'experimental_consumeApproval');
    const request = (await call(RELEASE_RPC.prepare, { action: 'agent.publish' })).data.request as ReleaseApprovalRequest;
    const token = harness.approve(request.binding);
    await expect(call(RELEASE_RPC.run, { action: 'agent.publish', token })).resolves.toMatchObject({ ok: true });
    expect(consume).toHaveBeenCalledWith({ token, binding: request.binding });
    expect(await zcc.storage.kv.get(publishKey)).toMatchObject({ revision: sha256Hex(SOURCE) });
    const state = (await call(RELEASE_RPC.state)).data as ReleaseState;
    expect(state.agent.lastPublish?.revision).toBe(sha256Hex(SOURCE));
  });
});

describe('Studio tests through the plugin', () => {
  it('reads the agent on disk for a spec and runs its eval in the DX project', async () => {
    const { harness, sf, dirs } = await setup();
    const studio = (name: string, args: Record<string, unknown> = {}) => harness.callRpc(name, { agentPath: PATH, ...args }) as Promise<any>;
    await expect(studio(STUDIO_RPC.suiteSpec, { agentPath: 'force-app/main/default/agents/Gone.agent' })).resolves.toMatchObject({ ok: false, code: 'not_found' });
    expect(await studio(STUDIO_RPC.suiteSave, { cases: [{ id: 'refund', name: 'Refund', utterances: ['I want a refund'] }] })).toMatchObject({ ok: true });
    dirs['/proj/tests'] = [basename(suitePathForAgent(PATH))];
    expect(await studio(STUDIO_RPC.suiteSpec)).toMatchObject({ ok: true, text: expect.stringContaining('MyBot') });
    expect(await studio(STUDIO_RPC.suiteEval)).toMatchObject({ ok: true });
    expect(sf.find(args => args[2] === 'run-eval')).toEqual(expect.arrayContaining(['--target-org', 'dev']));
    harness.setSettings({ defaultOrg: 'dev', projectRoot: '' });
    expect(await studio(STUDIO_RPC.suiteSpec)).toMatchObject({ ok: false });
  });
});
