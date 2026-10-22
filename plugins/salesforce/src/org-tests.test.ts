import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { boundResults, decodeEntities, mapRunResults, parseDefinitionXml, registerOrgTests, type OrgTestsDeps } from '../lib/org-tests.js';
import {
  ORG_TESTS_CHANGED_KIND, ORG_TESTS_LIMITS, ORG_TESTS_RPC, caseVerdict, definitionImportText, isOrgRunTerminal, orgMetricLabel, orgRunStatus, runCounts,
  type OrgCaseResult,
} from '../lib/org-tests-contract.js';
import { ReadGrants } from '../lib/release.js';
import { STUDIO_CHANGED_CHANNEL } from '../lib/studio-contract.js';

const RUN = '3A2dw0000000AbCAAU';
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<AiEvaluationDefinition xmlns="http://soap.sforce.com/2006/04/metadata">
  <name>Billing &amp; Refunds</name>
  <subjectName>Billing_Agent</subjectName>
  <subjectType>AGENT</subjectType>
  <subjectVersion>v18</subjectVersion>
  <testCase>
    <expectation><expectedValue>[&apos;LookupOrder&apos;]</expectedValue><name>action_sequence_match</name></expectation>
    <inputs>
      <contextVariable><variableName>currentRecordId</variableName><variableValue>001</variableValue></contextVariable>
      <conversationHistory><index>1</index><message>sure</message><role>agent</role></conversationHistory>
      <conversationHistory><index>0</index><message>hi &#38; &#x41;</message><role>user</role></conversationHistory>
      <utterance>Refund &quot;it&quot;</utterance>
    </inputs>
    <number>1</number>
  </testCase>
  <testCase><inputs><utterance>second</utterance></inputs></testCase>
</AiEvaluationDefinition>`;

function org(kind = 'sandbox') {
  return { alias: 'dev', username: 'u', orgId: '00D1', instanceUrl: 'https://x', apiVersion: '63.0', kind, isDefault: true };
}

function setup(opts: { kind?: string; approved?: boolean; xml?: string | null; xmlFor?: (name: string) => string | null | undefined; wrap?: (sdk: any) => any; cli?: Partial<{ code: number; stdout: string }>; ttl?: number; kv?: Map<string, unknown> } = {}) {
  const kvMap = opts.kv ?? new Map<string, unknown>();
  const handlers = new Map<string, (args: unknown) => Promise<any>>();
  const publish = vi.fn();
  let now = 1000;
  const requests: Array<{ path: string; init: any }> = [];
  const responses: Array<(path: string, init: any) => { status: number; json: unknown; text: string }> = [];
  const respond = (fn: (typeof responses)[number]) => responses.push(fn);
  const cliCalls: Array<{ args: string[]; cwd?: string }> = [];
  const dirs: string[] = [];
  const sdk = {
    connect: vi.fn(async () => org(opts.kind)),
    confirm: vi.fn(async () => opts.approved === false ? { approved: false, reason: 'denied' } : { approved: true, reason: 'submitted' }),
    request: vi.fn(async (path: string, init: any) => {
      requests.push({ path, init });
      const next = responses.shift();
      return { org: org(opts.kind), response: next ? next(path, init) : { status: 200, json: {}, text: '{}' } };
    }),
    execSf: vi.fn(async (args: string[], o: any) => {
      cliCalls.push({ args, cwd: o?.cwd });
      let files: unknown[] = [];
      if (args[0] === 'project') {
        dirs.push(o.cwd);
        if (opts.xml !== null) {
          const manifestXml = await readFile(join(o.cwd, 'package.xml'), 'utf8');
          const dir = join(o.cwd, 'force-app', 'main', 'default', 'aiEvaluationDefinitions');
          await mkdir(dir, { recursive: true });
          for (const [, name] of manifestXml.matchAll(/<members>([^<]+)<\/members>/g)) {
            const xml = opts.xmlFor ? opts.xmlFor(name!) : undefined;
            if (xml === null) continue;
            const filePath = join(dir, `${name}.aiEvaluationDefinition-meta.xml`);
            await writeFile(filePath, xml ?? opts.xml ?? XML);
            files.push({ type: 'AiEvaluationDefinition', fullName: name, filePath, state: 'Created' });
          }
        }
      }
      return { code: opts.cli?.code ?? 0, stderr: '', stdout: opts.cli?.stdout ?? JSON.stringify({ status: 0, result: args[0] === 'org' ? [
        { fullName: 'Old_Test', createdByName: 'Ann', lastModifiedDate: '2026-01-01T00:00:00.000Z' },
        { fullName: 'New_Test', createdByName: 'Bo', lastModifiedDate: '2026-09-01T00:00:00.000Z' },
        { fullName: 'bad name!' },
      ] : { files } }) };
    }),
  };
  const studio: any = {
    zcc: { storage: { kv: {
      get: async (k: string) => kvMap.get(k), set: async (k: string, v: unknown) => { kvMap.set(k, v); },
      delete: async (k: string) => { kvMap.delete(k); }, list: async () => [...kvMap.keys()],
    } }, realtime: { publish } },
    contexts: { current: () => ({ projectId: 'p1' }), key: (k: string) => `sf:project:p1:${k}` },
    deps: { now: () => ++now },
    registerRpc: (name: string, handler: (args: unknown) => Promise<any>) => handlers.set(name, handler),
  };
  const deps: OrgTestsDeps = { sdkFor: () => (opts.wrap ? opts.wrap(sdk) : sdk) as never, listTtlMs: opts.ttl };
  registerOrgTests(studio, deps);
  const call = (name: string, args: unknown = {}) => handlers.get(name)!(args);
  return { call, sdk, kvMap, publish, requests, respond, cliCalls, dirs, handlers };
}

const ok = (json: unknown) => () => ({ status: 200, json, text: '' });
const results = (testCases: unknown[], status = 'COMPLETED') => ({ status, startTime: '2026-09-01T00:00:00Z', subjectName: 'Billing_Agent', testCases });

describe('contract helpers', () => {
  it('maps statuses, verdicts and counts', () => {
    expect(['In Progress', 'COMPLETED', 'Cancelled', 'ERROR', 'queued', 'zzz', undefined].map(orgRunStatus)).toEqual(['in_progress', 'completed', 'terminated', 'error', 'new', 'new', 'new']);
    expect(isOrgRunTerminal('completed')).toBe(true);
    expect(isOrgRunTerminal('in_progress')).toBe(false);
    expect(caseVerdict({ status: 'completed', metrics: [] })).toBe('pass');
    expect(caseVerdict({ status: 'completed', metrics: [{ name: 'a', result: 'fail' }] })).toBe('fail');
    expect(caseVerdict({ status: 'completed', metrics: [{ name: 'a', result: null, error: 'boom' }] })).toBe('error');
    expect(caseVerdict({ status: 'error', metrics: [] })).toBe('error');
    expect(caseVerdict({ status: 'in_progress', metrics: [] })).toBe('pending');
    const rows = [{ verdict: 'pass' }, { verdict: 'fail' }] as OrgCaseResult[];
    expect(runCounts(rows, 5)).toEqual({ total: 5, pass: 1, fail: 1, error: 0, pending: 3 });
    expect(orgMetricLabel('topic_sequence_match')).toBe('Topic');
    expect(orgMetricLabel('some_new_metric')).toBe('Some new metric');
  });

  it('builds importable suite text', () => {
    const json = JSON.parse(definitionImportText({ name: 'N_1', label: 'Label' }, [
      { number: 2, utterance: 'hi', conversationHistory: [{ role: 'user', message: 'a' }], contextVariables: [], expectations: [{ name: 'x', expectedValue: 'v' }, { name: 'q' }, { name: 'e', expectedValue: '[]' }] },
    ]));
    expect(json.testCases[0]).toMatchObject({ id: 'n_1-2', inputs: { utterance: 'hi' }, expectation: [{ name: 'x', expectedValue: 'v' }] });
  });
});

describe('decodeEntities and parseDefinitionXml', () => {
  it('decodes named and numeric entities once', () => {
    expect(decodeEntities('&apos;a&apos; &quot;b&quot; &amp;amp; &lt;&gt; &#65;&#x42; &bogus; &#99999999;')).toBe(`'a' "b" &amp; <> AB &bogus; &#99999999;`);
  });

  it('parses cases, always as arrays, with entities and ordered history', () => {
    const def = parseDefinitionXml(XML, 'Billing_Test');
    expect(def).toMatchObject({ name: 'Billing_Test', label: 'Billing & Refunds', subjectName: 'Billing_Agent', subjectType: 'AGENT', subjectVersion: 'v18', caseCount: 2 });
    expect(def.testCases[0]).toEqual({
      number: 1, utterance: 'Refund "it"',
      conversationHistory: [{ role: 'user', message: 'hi & A' }, { role: 'agent', message: 'sure' }],
      contextVariables: [{ name: 'currentRecordId', value: '001' }],
      expectations: [{ name: 'action_sequence_match', expectedValue: "['LookupOrder']" }],
    });
    expect(def.testCases[1]).toMatchObject({ number: 2, utterance: 'second', conversationHistory: [], expectations: [] });
  });

  it('handles an empty definition, single elements and non-definition xml', () => {
    expect(parseDefinitionXml('<AiEvaluationDefinition><name>E</name></AiEvaluationDefinition>', 'E')).toMatchObject({ caseCount: 0, testCases: [] });
    const one = parseDefinitionXml('<AiEvaluationDefinition><testCase><expectation><name>x</name></expectation><inputs><utterance>u</utterance></inputs></testCase></AiEvaluationDefinition>', 'One');
    expect(one.label).toBe('One');
    expect(one.testCases).toHaveLength(1);
    expect(() => parseDefinitionXml('<Other/>', 'X')).toThrow(/not a readable/);
    expect(() => parseDefinitionXml('', 'X')).toThrow(/not a readable/);
  });

  it('caps cases and truncates long text', () => {
    const cases = Array.from({ length: ORG_TESTS_LIMITS.cases + 5 }, (_, i) => `<testCase><inputs><utterance>${i === 0 ? 'x'.repeat(ORG_TESTS_LIMITS.text + 50) : 'u'}</utterance></inputs></testCase>`).join('');
    const def = parseDefinitionXml(`<AiEvaluationDefinition>${cases}</AiEvaluationDefinition>`, 'Big');
    expect(def.testCases).toHaveLength(ORG_TESTS_LIMITS.cases);
    expect(def.truncated).toBe(true);
    expect(def.caseCount).toBe(ORG_TESTS_LIMITS.cases + 5);
    expect(def.testCases[0]!.utterance).toHaveLength(ORG_TESTS_LIMITS.text);
  });
});

describe('mapRunResults', () => {
  it('maps pass, fail, error and pending cases', () => {
    const mapped = mapRunResults(results([
      { status: 'COMPLETED', inputs: { utterance: 'a' }, testNumber: 1, generatedData: { actionsSequence: "['X', 'Y']", outcome: 'It&apos;s done', topic: 'T', sessionId: 's' }, testResults: [
        { name: 'topic_sequence_match', actualValue: 'T', expectedValue: 'T', score: 1, result: 'PASS', metricExplainability: 'ok &amp; fine', status: 'COMPLETED' },
        { name: 'completeness', score: 0.9, result: null },
      ] },
      { status: 'COMPLETED', inputs: { utterance: 'b' }, testNumber: 2, generatedData: { actionsSequence: ['Z'] }, testResults: [{ name: 'action_sequence_match', result: 'FAILURE' }] },
      { status: 'ERROR', inputs: { utterance: 'c' }, testNumber: 3, testResults: [{ name: 'x', status: 'ERROR', errorMessage: 'boom' }] },
      { status: 'IN_PROGRESS', inputs: { utterance: 'd' }, testNumber: 4 },
    ]));
    expect(mapped.status).toBe('completed');
    expect(mapped.subjectName).toBe('Billing_Agent');
    expect(mapped.cases.map(c => c.verdict)).toEqual(['pass', 'fail', 'error', 'pending']);
    expect(mapped.cases[0]).toMatchObject({ actions: ['X', 'Y'], reply: "It's done", topic: 'T', sessionId: 's' });
    expect(mapped.cases[0]!.metrics[0]).toMatchObject({ result: 'pass', explanation: 'ok & fine', expected: 'T', actual: 'T', score: 1 });
    expect(mapped.cases[1]!.actions).toEqual(['Z']);
    expect(mapped.cases[2]!.metrics[0]).toMatchObject({ error: 'boom', status: 'error' });
  });

  it('copes with garbage payloads and loose action strings', () => {
    expect(mapRunResults(null)).toMatchObject({ status: 'new', cases: [] });
    expect(mapRunResults({ status: 'ERROR', errorMessage: 'bad', testCases: [{ generatedData: { actionsSequence: '[a, "b"]' } }, { generatedData: { actionsSequence: '' } }] }))
      .toMatchObject({ status: 'error', errorMessage: 'bad', cases: [{ actions: ['a', 'b'], number: 1 }, { actions: [], number: 2 }] });
  });
});

describe('org tests RPCs', () => {
  it('registers every contract method', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(Object.values(ORG_TESTS_RPC).sort());
  });

  it('lists definitions sorted, caches, and refreshes on request', async () => {
    const t = setup();
    const first = await t.call(ORG_TESTS_RPC.list);
    expect(first).toMatchObject({ ok: true, org: { alias: 'dev', id: '00D1', isProduction: false } });
    expect(first.definitions.map((d: any) => d.name)).toEqual(['New_Test', 'Old_Test']);
    expect(first.definitions[0]).toMatchObject({ createdBy: 'Bo' });
    expect(t.cliCalls[0]!.args).toEqual(['org', 'list', 'metadata', '-m', 'AiEvaluationDefinition', '--json', '--target-org', 'dev']);
    await t.call(ORG_TESTS_RPC.list);
    expect(t.sdk.execSf).toHaveBeenCalledTimes(1);
    await t.call(ORG_TESTS_RPC.list, { refresh: true });
    expect(t.sdk.execSf).toHaveBeenCalledTimes(2);
  });

  it('expires the list cache and enriches from fetched definitions', async () => {
    const t = setup({ ttl: 5 });
    await t.call(ORG_TESTS_RPC.list);
    await t.call(ORG_TESTS_RPC.definition, { name: 'New_Test' });
    const again = await t.call(ORG_TESTS_RPC.list);
    expect(t.cliCalls.filter(c => c.args[0] === 'org')).toHaveLength(1);
    expect(again.definitions.find((d: any) => d.name === 'New_Test')).toMatchObject({ label: 'Billing & Refunds', caseCount: 2, subjectName: 'Billing_Agent' });
    const later = setup({ ttl: -1 });
    await later.call(ORG_TESTS_RPC.list);
    await later.call(ORG_TESTS_RPC.list);
    expect(later.sdk.execSf).toHaveBeenCalledTimes(2);
  });

  it('reports CLI failures and single-object results', async () => {
    expect(await setup({ cli: { code: 1, stdout: JSON.stringify({ status: 1, message: 'No auth' }) } }).call(ORG_TESTS_RPC.list)).toEqual({ ok: false, code: 'cli_error', error: 'No auth' });
    expect(await setup({ cli: { stdout: 'not json' } }).call(ORG_TESTS_RPC.list)).toMatchObject({ ok: false, code: 'cli_error' });
    expect(await setup({ cli: { stdout: JSON.stringify({ status: 0, result: { fullName: 'Only_One' } }) } }).call(ORG_TESTS_RPC.list)).toMatchObject({ definitions: [{ name: 'Only_One' }] });
    expect(await setup({ cli: { stdout: JSON.stringify({ status: 0 }) } }).call(ORG_TESTS_RPC.list)).toMatchObject({ definitions: [] });
  });

  it('propagates a refused org read', async () => {
    const t = setup({ kind: 'production', approved: false });
    for (const [name, args] of [[ORG_TESTS_RPC.list, {}], [ORG_TESTS_RPC.definition, { name: 'A' }], [ORG_TESTS_RPC.start, { name: 'A' }], [ORG_TESTS_RPC.attach, { runId: RUN }]] as const) {
      expect(await t.call(name, args)).toMatchObject({ ok: false, code: 'refused' });
    }
    expect(t.cliCalls).toHaveLength(0);
    expect(t.requests).toHaveLength(0);
    expect(t.sdk.confirm).toHaveBeenCalledWith(expect.objectContaining({ orgKind: 'production' }), '');
  });

  it('flags production orgs and passes the thread id to mediation', async () => {
    const t = setup({ kind: 'production' });
    expect((await t.call(ORG_TESTS_RPC.list, { threadId: 'th1' })).org.isProduction).toBe(true);
    expect(t.sdk.confirm).toHaveBeenCalledWith(expect.anything(), 'th1');
  });

  it('retrieves a definition, caches it and cleans the temp dir', async () => {
    const t = setup();
    const reply = await t.call(ORG_TESTS_RPC.definition, { name: 'Billing_Test' });
    expect(reply.definition).toMatchObject({ name: 'Billing_Test', caseCount: 2 });
    expect(t.cliCalls[0]!.args.slice(0, 5)).toEqual(['project', 'retrieve', 'start', '--manifest', 'package.xml']);
    expect(t.cliCalls[0]!.args).toContain('dev');
    expect(await readdir(tmpdir()).then(list => list.includes(t.dirs[0]!.split('/').pop()!))).toBe(false);
    await t.call(ORG_TESTS_RPC.definition, { name: 'Billing_Test' });
    expect(t.sdk.execSf).toHaveBeenCalledTimes(1);
    await t.call(ORG_TESTS_RPC.definition, { name: 'Billing_Test', refresh: true });
    expect(t.sdk.execSf).toHaveBeenCalledTimes(2);
  });

  it('retrieves with API 63.0 or later, whatever older version the org defaults to', async () => {
    const t = setup();
    let manifestVersion = '';
    const inner = t.sdk.execSf.getMockImplementation()!;
    t.sdk.execSf.mockImplementation(async (args: string[], o: any) => {
      const result = await inner(args, o);
      if (args[0] === 'project') manifestVersion = /<version>([^<]+)<\/version>/.exec(await readFile(join(o.cwd, 'package.xml'), 'utf8'))![1]!;
      return result;
    });
    t.sdk.connect.mockResolvedValue({ ...org(), apiVersion: '60.0' });
    expect((await t.call(ORG_TESTS_RPC.definition, { name: 'Billing_Test' })).ok).toBe(true);
    expect(manifestVersion).toBe('63.0');
    t.sdk.connect.mockResolvedValue({ ...org(), apiVersion: '65.0' });
    await t.call(ORG_TESTS_RPC.definition, { name: 'Other_Test' });
    expect(manifestVersion).toBe('65.0');
  });

  it('bounds the definition cache', async () => {
    const t = setup();
    for (let i = 0; i < 62; i++) await t.call(ORG_TESTS_RPC.definition, { name: `D${i}` });
    await t.call(ORG_TESTS_RPC.definition, { name: 'D0' });
    expect(t.sdk.execSf).toHaveBeenCalledTimes(63);
  });

  it('validates names and fails definitions cleanly, always cleaning up', async () => {
    const t = setup();
    for (const name of ['', '1abc', 'a-b', 'a/../b', 'x'.repeat(81)]) {
      expect(await t.call(ORG_TESTS_RPC.definition, { name })).toMatchObject({ ok: false, code: 'invalid_input' });
    }
    expect(t.cliCalls).toHaveLength(0);
    expect(await t.call(ORG_TESTS_RPC.definition, undefined)).toMatchObject({ code: 'invalid_input' });
    const missing = setup({ xml: null });
    expect(await missing.call(ORG_TESTS_RPC.definition, { name: 'Gone' })).toMatchObject({ ok: false, code: 'not_found' });
    const bad = setup({ xml: '<nope/>' });
    expect(await bad.call(ORG_TESTS_RPC.definition, { name: 'Bad' })).toMatchObject({ ok: false, code: 'invalid_definition' });
    const failing = setup({ cli: { code: 1, stdout: JSON.stringify({ status: 1, message: 'denied' }) } });
    expect(await failing.call(ORG_TESTS_RPC.definition, { name: 'Bad' })).toEqual({ ok: false, code: 'cli_error', error: 'denied' });
    const garbage = setup({ cli: { stdout: 'x' } });
    expect(await garbage.call(ORG_TESTS_RPC.definition, { name: 'Bad' })).toMatchObject({ code: 'cli_error' });
    const thrown = setup();
    thrown.sdk.execSf.mockRejectedValueOnce(new Error('spawn failed'));
    expect(await thrown.call(ORG_TESTS_RPC.definition, { name: 'Bad' })).toEqual({ ok: false, code: 'cli_error', error: 'spawn failed' });
    for (const s of [missing, bad, failing]) for (const dir of s.dirs) expect((await readdir(tmpdir())).includes(dir.split('/').pop()!)).toBe(false);
  });

  it('refuses an oversize definition file', async () => {
    const t = setup({ xml: `<AiEvaluationDefinition>${'<!-- -->'.repeat(ORG_TESTS_LIMITS.definitionBytes / 8 + 10)}</AiEvaluationDefinition>` });
    expect(await t.call(ORG_TESTS_RPC.definition, { name: 'Huge' })).toMatchObject({ ok: false, code: 'too_large' });
    expect((await readdir(tmpdir())).includes(t.dirs[0]!.split('/').pop()!)).toBe(false);
  });

  describe('details', () => {
    const subject = (agent: string) => XML.replace('Billing_Agent', agent);

    it('reads a batch in one retrieve, reports what the org did not return, and enriches the list', async () => {
      const t = setup({ xmlFor: name => (name === 'Gone' ? null : name === 'Old_Test' ? subject('Other_Agent') : undefined) });
      await t.call(ORG_TESTS_RPC.list);
      const reply = await t.call(ORG_TESTS_RPC.details, { names: ['New_Test', 'Old_Test', 'Gone', 'New_Test'] });
      expect(reply).toEqual({
        ok: true, missing: ['Gone'],
        definitions: [
          { name: 'New_Test', label: 'Billing & Refunds', subjectName: 'Billing_Agent', subjectType: 'AGENT', subjectVersion: 'v18', caseCount: 2 },
          { name: 'Old_Test', label: 'Billing & Refunds', subjectName: 'Other_Agent', subjectType: 'AGENT', subjectVersion: 'v18', caseCount: 2 },
        ],
      });
      const retrieves = t.cliCalls.filter(c => c.args[0] === 'project');
      expect(retrieves).toHaveLength(1);
      expect(t.dirs).toHaveLength(1);
      expect((await readdir(tmpdir())).includes(t.dirs[0]!.split('/').pop()!)).toBe(false);
      const list = await t.call(ORG_TESTS_RPC.list);
      expect(list.definitions.map((d: any) => d.subjectName)).toEqual(['Billing_Agent', 'Other_Agent']);
    });

    it('serves known names from the cache, retrieves only the rest, and re-reads on refresh', async () => {
      const t = setup();
      await t.call(ORG_TESTS_RPC.definition, { name: 'A_Test' });
      await t.call(ORG_TESTS_RPC.details, { names: ['A_Test'] });
      expect(t.sdk.execSf).toHaveBeenCalledTimes(1);
      await t.call(ORG_TESTS_RPC.details, { names: ['A_Test', 'B_Test'] });
      const manifests: string[] = [];
      const inner = t.sdk.execSf.getMockImplementation()!;
      t.sdk.execSf.mockImplementation(async (args: string[], o: any) => {
        if (args[0] === 'project') manifests.push(await readFile(join(o.cwd, 'package.xml'), 'utf8'));
        return inner(args, o);
      });
      await t.call(ORG_TESTS_RPC.details, { names: ['A_Test', 'B_Test'], refresh: true });
      expect(t.sdk.execSf).toHaveBeenCalledTimes(3);
      expect(manifests[0]).toContain('<members>A_Test</members>');
      expect(manifests[0]).toContain('<members>B_Test</members>');
    });

    it('keeps the readable definitions of a batch when one is unreadable or too large', async () => {
      const t = setup({ xmlFor: name => (name === 'Bad' ? '<nope/>' : name === 'Huge' ? `<AiEvaluationDefinition>${'<!-- -->'.repeat(ORG_TESTS_LIMITS.definitionBytes / 8 + 10)}</AiEvaluationDefinition>` : undefined) });
      const reply = await t.call(ORG_TESTS_RPC.details, { names: ['Good', 'Bad', 'Huge'] });
      expect(reply.definitions.map((d: any) => d.name)).toEqual(['Good']);
      expect(reply.missing).toEqual(['Bad', 'Huge']);
    });

    it('validates the names, and fails a batch the CLI cannot retrieve', async () => {
      const t = setup();
      for (const args of [undefined, {}, { names: [] }, { names: 'A' }, { names: ['ok', 'bad name'] }, { names: [1] }, { names: Array.from({ length: ORG_TESTS_LIMITS.detailsBatch + 1 }, (_, i) => `N${i}`) }]) {
        expect(await t.call(ORG_TESTS_RPC.details, args)).toMatchObject({ ok: false, code: 'invalid_input' });
      }
      expect(t.sdk.connect).not.toHaveBeenCalled();
      const failing = setup({ cli: { code: 1, stdout: JSON.stringify({ status: 1, message: 'UNKNOWN_EXCEPTION' }) } });
      expect(await failing.call(ORG_TESTS_RPC.details, { names: ['A'] })).toEqual({ ok: false, code: 'cli_error', error: 'UNKNOWN_EXCEPTION' });
      expect((await readdir(tmpdir())).includes(failing.dirs[0]!.split('/').pop()!)).toBe(false);
      const refused = setup({ kind: 'production', approved: false });
      expect(await refused.call(ORG_TESTS_RPC.details, { names: ['A'] })).toMatchObject({ ok: false, code: 'refused' });
      expect(refused.cliCalls).toHaveLength(0);
    });

    it('opens a test read by a batch without retrieving it again', async () => {
      const t = setup();
      await t.call(ORG_TESTS_RPC.details, { names: ['A_Test'] });
      expect((await t.call(ORG_TESTS_RPC.definition, { name: 'A_Test' })).definition.testCases).toHaveLength(2);
      expect(t.cliCalls.filter(c => c.args[0] === 'project')).toHaveLength(1);
    });

    it('stores summaries per org, so a restart lists agents without retrieving, and reads a changed test again', async () => {
      const kv = new Map<string, unknown>();
      const first = setup({ kv });
      await first.call(ORG_TESTS_RPC.list);
      await first.call(ORG_TESTS_RPC.details, { names: ['Old_Test', 'New_Test'] });
      expect(kv.get('orgTests:summaries:00D1')).toEqual({ rows: {
        Old_Test: { label: 'Billing & Refunds', subjectName: 'Billing_Agent', subjectType: 'AGENT', subjectVersion: 'v18', caseCount: 2, lastModified: '2026-01-01T00:00:00.000Z' },
        New_Test: { label: 'Billing & Refunds', subjectName: 'Billing_Agent', subjectType: 'AGENT', subjectVersion: 'v18', caseCount: 2, lastModified: '2026-09-01T00:00:00.000Z' },
      } });
      const second = setup({ kv });
      const listed = await second.call(ORG_TESTS_RPC.list);
      expect(listed.definitions.map((d: any) => [d.name, d.subjectName, d.lastModified])).toEqual([['New_Test', 'Billing_Agent', '2026-09-01T00:00:00.000Z'], ['Old_Test', 'Billing_Agent', '2026-01-01T00:00:00.000Z']]);
      expect(await second.call(ORG_TESTS_RPC.details, { names: ['Old_Test', 'New_Test'] })).toMatchObject({ missing: [], definitions: [{ name: 'Old_Test' }, { name: 'New_Test' }] });
      expect(second.cliCalls.filter(c => c.args[0] === 'project')).toHaveLength(0);

      const rows = (kv.get('orgTests:summaries:00D1') as any).rows;
      rows.Old_Test.lastModified = '2025-12-01T00:00:00.000Z';
      const third = setup({ kv });
      expect((await third.call(ORG_TESTS_RPC.list)).definitions.find((d: any) => d.name === 'Old_Test').subjectName).toBeUndefined();
      expect(Object.keys((kv.get('orgTests:summaries:00D1') as any).rows)).toEqual(['New_Test']);
      await third.call(ORG_TESTS_RPC.details, { names: ['Old_Test', 'New_Test'] });
      const manifests = third.cliCalls.filter(c => c.args[0] === 'project');
      expect(manifests).toHaveLength(1);
      expect((kv.get('orgTests:summaries:00D1') as any).rows.Old_Test.lastModified).toBe('2026-01-01T00:00:00.000Z');
    });

    it('takes the listed version for a summary read before any list, and ignores unreadable stored rows', async () => {
      const kv = new Map<string, unknown>([['orgTests:summaries:00D1', { rows: { 'bad name': { subjectName: 'X' }, Junk: 'x', NoAgent: { label: 'L' }, Odd: { subjectName: 'Odd_Agent', caseCount: -1, label: 7 } } }]]);
      const t = setup({ kv });
      await t.call(ORG_TESTS_RPC.definition, { name: 'New_Test' });
      expect((kv.get('orgTests:summaries:00D1') as any).rows.New_Test.lastModified).toBeUndefined();
      await t.call(ORG_TESTS_RPC.list);
      expect((kv.get('orgTests:summaries:00D1') as any).rows.New_Test.lastModified).toBe('2026-09-01T00:00:00.000Z');
      expect(await t.call(ORG_TESTS_RPC.details, { names: ['Odd', 'NoAgent'] })).toMatchObject({ definitions: [{ name: 'Odd', subjectName: 'Odd_Agent' }, { name: 'NoAgent', subjectName: 'Billing_Agent' }] });
      expect((await t.call(ORG_TESTS_RPC.details, { names: ['Odd'] })).definitions[0].caseCount).toBeUndefined();
    });

    it('still lists and reads when storage cannot be read or written', async () => {
      const kv = new (class extends Map<string, unknown> {
        override get(): never { throw new Error('read failed'); }
        override set(): never { throw new Error('write failed'); }
      })();
      const t = setup({ kv });
      expect((await t.call(ORG_TESTS_RPC.list)).ok).toBe(true);
      expect(await t.call(ORG_TESTS_RPC.details, { names: ['New_Test'] })).toMatchObject({ ok: true, definitions: [{ subjectName: 'Billing_Agent' }] });
    });

    it('bounds the summary cache across orgs', async () => {
      const names = (from: number) => Array.from({ length: ORG_TESTS_LIMITS.detailsBatch }, (_, i) => `S${from + i}`);
      const seeds = [['00D1', 0, 2_000], ['00D2', 2_000, 2_000], ['00D3', 4_000, 1_000]] as const;
      const kv = new Map<string, unknown>(seeds.map(([id, from, count]) => [
        `orgTests:summaries:${id}`,
        { rows: Object.fromEntries(Array.from({ length: count }, (_, i) => [`S${from + i}`, { subjectName: 'Billing_Agent' }])) },
      ]));
      let orgId: string = seeds[0][0];
      const t = setup({ kv, wrap: sdk => ({ ...sdk, connect: async () => ({ ...org(), orgId }) }) });
      // Fill the cache from valid persisted snapshots, avoiding 5,000 unrelated file writes.
      for (const [id, from] of seeds) {
        orgId = id;
        expect(await t.call(ORG_TESTS_RPC.details, { names: names(from) })).toMatchObject({ ok: true, missing: [] });
      }
      expect(t.sdk.execSf).not.toHaveBeenCalled();
      await t.call(ORG_TESTS_RPC.details, { names: names(5_000) });
      const calls = t.sdk.execSf.mock.calls.length;
      expect(calls).toBe(1);
      orgId = '00D1';
      await t.call(ORG_TESTS_RPC.details, { names: names(0) });
      expect(t.sdk.execSf.mock.calls.length).toBe(calls + 1);
      orgId = '00D3';
      await t.call(ORG_TESTS_RPC.details, { names: names(5_000) });
      expect(t.sdk.execSf.mock.calls.length).toBe(calls + 1);
    });
  });

  describe('runs', () => {
    it('starts a run, stores it, and publishes a change', async () => {
      const t = setup();
      t.respond(ok({ id: RUN, status: 'NEW' }));
      const reply = await t.call(ORG_TESTS_RPC.start, { name: 'Billing_Test' });
      expect(reply).toMatchObject({ ok: true, run: { runId: RUN, definition: 'Billing_Test', status: 'new', startedBy: 'studio', orgAlias: 'dev', orgId: '00D1' } });
      expect(reply.run.threadId).toBeUndefined();
      expect(t.requests[0]).toMatchObject({ path: '/einstein/ai-evaluations/runs', init: { method: 'POST', body: { aiEvaluationDefinitionName: 'Billing_Test' }, apiVersion: '63.0', alias: 'dev' } });
      expect(t.publish).toHaveBeenCalledWith(STUDIO_CHANGED_CHANNEL, { projectId: 'p1', kind: ORG_TESTS_CHANGED_KIND, runId: RUN });
      expect((await t.call(ORG_TESTS_RPC.runs, {})).runs).toHaveLength(1);
    });

    it('marks thread-started runs and seeds counts from a known definition', async () => {
      const t = setup();
      await t.call(ORG_TESTS_RPC.definition, { name: 'Billing_Test' });
      t.respond(ok({ id: RUN }));
      const reply = await t.call(ORG_TESTS_RPC.start, { name: 'Billing_Test', threadId: 'th9' });
      expect(reply.run).toMatchObject({ startedBy: 'thread', threadId: 'th9', subjectName: 'Billing_Agent', counts: { total: 2, pending: 2 } });
    });

    it('fails start on invalid input, API errors and a missing run id', async () => {
      const t = setup();
      expect(await t.call(ORG_TESTS_RPC.start, { name: 'no way' })).toMatchObject({ code: 'invalid_input' });
      t.respond(() => ({ status: 400, json: [{ message: 'bad def', errorCode: 'X' }], text: '' }));
      expect(await t.call(ORG_TESTS_RPC.start, { name: 'A' })).toMatchObject({ ok: false, code: 'api_error' });
      t.respond(ok({ nothing: true }));
      expect(await t.call(ORG_TESTS_RPC.start, { name: 'A' })).toMatchObject({ ok: false, code: 'api_error', error: expect.stringMatching(/run id/) });
      t.respond(ok({ id: 'short' }));
      expect(await t.call(ORG_TESTS_RPC.start, { name: 'A' })).toMatchObject({ code: 'api_error' });
      expect((await t.call(ORG_TESTS_RPC.runs)).runs).toEqual([]);
    });

    async function started(t: ReturnType<typeof setup>) {
      t.respond(ok({ id: RUN, status: 'NEW' }));
      await t.call(ORG_TESTS_RPC.start, { name: 'Billing_Test' });
      t.publish.mockClear();
    }

    it('reads an in-progress run without caching it', async () => {
      const t = setup();
      await started(t);
      t.respond(ok({ status: 'IN_PROGRESS' }));
      t.respond(ok(results([{ status: 'COMPLETED', inputs: { utterance: 'a' }, testNumber: 1, testResults: [] }, { status: 'IN_PROGRESS', inputs: { utterance: 'b' }, testNumber: 2 }], 'IN_PROGRESS')));
      const reply = await t.call(ORG_TESTS_RPC.run, { runId: RUN });
      expect(reply.run).toMatchObject({ status: 'in_progress', counts: { total: 2, pass: 1, pending: 1 } });
      expect(reply.run.endedAt).toBeUndefined();
      expect(t.requests.map(r => r.path)).toEqual([expect.any(String), `/einstein/ai-evaluations/runs/${RUN}`, `/einstein/ai-evaluations/runs/${RUN}/results`]);
      expect(t.publish).toHaveBeenCalledTimes(1);
      expect([...t.kvMap.keys()].some(k => k.includes('orgTests:result:'))).toBe(false);
    });

    it('does not fetch results for a run that has not begun', async () => {
      const t = setup();
      await started(t);
      t.respond(ok({ status: 'NEW' }));
      const reply = await t.call(ORG_TESTS_RPC.run, { runId: RUN });
      expect(reply.run).toMatchObject({ status: 'new', cases: [] });
      expect(t.requests).toHaveLength(2);
    });

    it('caches terminal results so reopening does not hit the org', async () => {
      const t = setup();
      await started(t);
      t.respond(ok({ status: 'COMPLETED' }));
      t.respond(ok(results([
        { status: 'COMPLETED', inputs: { utterance: 'a' }, testNumber: 1, testResults: [{ name: 'x', result: 'PASS' }] },
        { status: 'COMPLETED', inputs: { utterance: 'b' }, testNumber: 2, testResults: [{ name: 'x', result: 'FAILURE' }] },
      ])));
      const first = await t.call(ORG_TESTS_RPC.run, { runId: RUN });
      expect(first.run).toMatchObject({ status: 'completed', counts: { total: 2, pass: 1, fail: 1 }, subjectName: 'Billing_Agent' });
      expect(first.run.endedAt).toEqual(expect.any(Number));
      const calls = t.requests.length;
      const second = await t.call(ORG_TESTS_RPC.run, { runId: RUN });
      expect(t.requests).toHaveLength(calls);
      expect(second.run.cases).toHaveLength(2);
      expect((await t.call(ORG_TESTS_RPC.runs, {})).runs[0]).toMatchObject({ status: 'completed', counts: { pass: 1, fail: 1 } });
    });

    it('records run-level errors', async () => {
      const t = setup();
      await started(t);
      t.respond(ok({ status: 'ERROR', errorMessage: 'agent inactive' }));
      t.respond(ok({ status: 'ERROR', errorMessage: 'agent inactive', testCases: [] }));
      expect((await t.call(ORG_TESTS_RPC.run, { runId: RUN })).run).toMatchObject({ status: 'error', errorMessage: 'agent inactive' });
    });

    it('reports API failures and unknown ids on get', async () => {
      const t = setup();
      expect(await t.call(ORG_TESTS_RPC.run, { runId: 'bad' })).toMatchObject({ code: 'invalid_input' });
      expect(await t.call(ORG_TESTS_RPC.run, { runId: RUN })).toMatchObject({ code: 'not_found' });
      await started(t);
      t.respond(() => ({ status: 500, json: null, text: 'down' }));
      expect(await t.call(ORG_TESTS_RPC.run, { runId: RUN })).toMatchObject({ ok: false, code: 'api_error' });
      t.respond(ok({ status: 'COMPLETED' }));
      t.respond(() => ({ status: 500, json: null, text: 'down' }));
      expect(await t.call(ORG_TESTS_RPC.run, { runId: RUN })).toMatchObject({ ok: false, code: 'api_error' });
      t.respond(ok({ status: 'IN_PROGRESS' }));
      t.respond(() => ({ status: 404, json: null, text: '' }));
      expect((await t.call(ORG_TESTS_RPC.run, { runId: RUN })).run).toMatchObject({ status: 'in_progress', cases: [] });
    });

    it('is refused on a production org without a grant', async () => {
      const t = setup({ kind: 'production', approved: true });
      await started(t);
      t.sdk.confirm.mockResolvedValueOnce({ approved: false, reason: 'denied' } as never);
      expect(await t.call(ORG_TESTS_RPC.run, { runId: RUN })).toMatchObject({ ok: false, code: 'refused' });
      expect(await t.call(ORG_TESTS_RPC.cancel, { runId: RUN })).toMatchObject({ ok: true });
    });

    it('cancels a run, and is idempotent for finished or unknown runs', async () => {
      const t = setup();
      await started(t);
      t.respond(ok({}));
      const reply = await t.call(ORG_TESTS_RPC.cancel, { runId: RUN });
      expect(reply.run).toMatchObject({ status: 'terminated', endedAt: expect.any(Number) });
      expect(t.requests.at(-1)).toMatchObject({ path: `/einstein/ai-evaluations/runs/${RUN}/cancel`, init: { method: 'POST' } });
      expect(t.publish).toHaveBeenCalledTimes(1);
      const calls = t.requests.length;
      expect((await t.call(ORG_TESTS_RPC.cancel, { runId: RUN })).run.status).toBe('terminated');
      expect(t.requests).toHaveLength(calls);
      expect(await t.call(ORG_TESTS_RPC.cancel, { runId: 'zzzzzzzzzzzzzzzzzz' })).toMatchObject({ code: 'not_found' });
      expect(await t.call(ORG_TESTS_RPC.cancel, {})).toMatchObject({ code: 'invalid_input' });
    });

    it('reports cancel API failures and keeps the run', async () => {
      const t = setup();
      await started(t);
      t.respond(() => ({ status: 409, json: null, text: 'nope' }));
      expect(await t.call(ORG_TESTS_RPC.cancel, { runId: RUN })).toMatchObject({ ok: false, code: 'api_error' });
      expect((await t.call(ORG_TESTS_RPC.runs)).runs[0]).toMatchObject({ status: 'new' });
    });

    it('filters history by definition, newest first', async () => {
      const t = setup();
      for (const [id, name] of [['A00000000000001', 'First'], ['A00000000000002', 'Second'], ['A00000000000003', 'First']]) {
        t.respond(ok({ id }));
        await t.call(ORG_TESTS_RPC.start, { name });
      }
      expect((await t.call(ORG_TESTS_RPC.runs, {})).runs.map((r: any) => r.runId)).toEqual(['A00000000000003', 'A00000000000002', 'A00000000000001']);
      expect((await t.call(ORG_TESTS_RPC.runs, { name: 'First' })).runs.map((r: any) => r.runId)).toEqual(['A00000000000003', 'A00000000000001']);
    });

    it('serializes concurrent writes and caps the stored history', async () => {
      const t = setup();
      const total = ORG_TESTS_LIMITS.storedRuns + 5;
      const ids = Array.from({ length: total }, (_, i) => `B${String(i).padStart(14, '0')}`);
      ids.forEach(id => t.respond(ok({ id })));
      await Promise.all(ids.map(() => t.call(ORG_TESTS_RPC.start, { name: 'Many' })));
      const { runs } = await t.call(ORG_TESTS_RPC.runs, {});
      expect(runs).toHaveLength(ORG_TESTS_LIMITS.storedRuns);
      expect(new Set(runs.map((r: any) => r.runId)).size).toBe(ORG_TESTS_LIMITS.storedRuns);
    });

    it('drops cached results of runs that fall out of the history', async () => {
      const t = setup();
      await started(t);
      t.respond(ok({ status: 'COMPLETED' }));
      t.respond(ok(results([])));
      await t.call(ORG_TESTS_RPC.run, { runId: RUN });
      expect([...t.kvMap.keys()].some(k => k.endsWith(`orgTests:result:${RUN}`))).toBe(true);
      for (let i = 0; i < ORG_TESTS_LIMITS.storedRuns; i++) {
        t.respond(ok({ id: `C${String(i).padStart(14, '0')}` }));
        await t.call(ORG_TESTS_RPC.start, { name: 'Fill' });
      }
      expect([...t.kvMap.keys()].some(k => k.endsWith(`orgTests:result:${RUN}`))).toBe(false);
    });

    it('attaches an outside run, with its start time', async () => {
      const t = setup();
      t.respond(ok({ status: 'COMPLETED', startTime: '2026-09-02T10:00:00Z' }));
      t.respond(ok(results([{ status: 'COMPLETED', inputs: { utterance: 'a' }, testNumber: 1, testResults: [] }])));
      const reply = await t.call(ORG_TESTS_RPC.attach, { runId: RUN, name: 'Billing_Test' });
      expect(reply.run).toMatchObject({ startedBy: 'attached', definition: 'Billing_Test', status: 'completed', startedAt: Date.parse('2026-09-02T10:00:00Z'), counts: { pass: 1 } });
      expect(t.publish).toHaveBeenCalledTimes(1);
      t.respond(ok({ status: 'COMPLETED' }));
      t.respond(ok(results([])));
      const again = await t.call(ORG_TESTS_RPC.attach, { runId: RUN });
      expect(again.run).toMatchObject({ startedBy: 'attached', definition: 'Billing_Test' });
      expect((await t.call(ORG_TESTS_RPC.runs)).runs).toHaveLength(1);
    });

    it('attaches without a name and rejects bad input or API failures', async () => {
      const t = setup();
      t.respond(ok({ status: 'NEW' }));
      expect((await t.call(ORG_TESTS_RPC.attach, { runId: RUN })).run.definition).toBe('unknown');
      expect(await t.call(ORG_TESTS_RPC.attach, { runId: 'x' })).toMatchObject({ code: 'invalid_input' });
      expect(await t.call(ORG_TESTS_RPC.attach, { runId: RUN, name: 'bad name' })).toMatchObject({ code: 'invalid_input' });
      t.respond(() => ({ status: 404, json: null, text: 'missing' }));
      expect(await t.call(ORG_TESTS_RPC.attach, { runId: 'D00000000000009' })).toMatchObject({ ok: false, code: 'api_error' });
    });

    it('survives a failing realtime publish and a failing sdk', async () => {
      const t = setup();
      t.publish.mockImplementation(() => { throw new Error('closed'); });
      t.respond(ok({ id: RUN }));
      expect(await t.call(ORG_TESTS_RPC.start, { name: 'A' })).toMatchObject({ ok: true });
      t.sdk.connect.mockRejectedValueOnce(new Error('no org'));
      expect(await t.call(ORG_TESTS_RPC.start, { name: 'A' })).toEqual({ ok: false, code: 'failed', error: 'no org' });
      t.sdk.connect.mockRejectedValueOnce('weird');
      expect(await t.call(ORG_TESTS_RPC.list)).toEqual({ ok: false, code: 'failed', error: 'weird' });
    });
  });
});

describe('org tests review fixes', () => {
  const started = async (t: ReturnType<typeof setup>, args: Record<string, unknown> = { name: 'Billing_Test' }) => {
    t.respond(ok({ id: RUN, status: 'NEW' }));
    const reply = await t.call(ORG_TESTS_RPC.start, args);
    t.publish.mockClear();
    return reply;
  };

  it('start and cancel confirm as org.write on production, which a read grant never satisfies', async () => {
    const grants = new ReadGrants(() => 1000);
    grants.grant('p1', '00D1');
    const t = setup({ kind: 'production', wrap: sdk => grants.wrap(sdk, 'p1') });
    await t.call(ORG_TESTS_RPC.list);
    expect(t.sdk.confirm).not.toHaveBeenCalled();
    await started(t, { name: 'A', threadId: 'th1' });
    expect(t.sdk.confirm).toHaveBeenCalledTimes(1);
    expect(t.sdk.confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: 'org.write', orgKind: 'production' }), 'th1');
    t.respond(ok({}));
    await t.call(ORG_TESTS_RPC.cancel, { runId: RUN, threadId: 'th1' });
    expect(t.sdk.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'org.write' }), 'th1');
    const denied = setup({ kind: 'production', approved: false, wrap: sdk => grants.wrap(sdk, 'p1') });
    expect(await denied.call(ORG_TESTS_RPC.start, { name: 'A' })).toMatchObject({ ok: false, code: 'refused' });
    expect(denied.requests).toHaveLength(0);
    const unknown = setup({ kind: 'unknown' });
    await started(unknown);
    expect(unknown.sdk.confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: 'org.write' }), '');
  });

  it('start does not add a write confirmation on a sandbox', async () => {
    const t = setup();
    await started(t);
    expect(t.sdk.confirm.mock.calls[0]![0]).not.toHaveProperty('kind');
  });

  it('startedBy honours via', async () => {
    expect((await started(setup(), { name: 'A', threadId: 't', via: 'studio' })).run.startedBy).toBe('studio');
    expect((await started(setup(), { name: 'A', threadId: 't' })).run.startedBy).toBe('thread');
    expect((await started(setup(), { name: 'A', via: 'other' })).run.startedBy).toBe('studio');
  });

  it('attach only names a record that is new or unknown', async () => {
    const t = setup();
    await started(t);
    t.respond(ok({ status: 'IN_PROGRESS' })); t.respond(ok(results([], 'IN_PROGRESS')));
    expect((await t.call(ORG_TESTS_RPC.attach, { runId: RUN, name: 'Other_Name' })).run.definition).toBe('Billing_Test');
    const u = setup();
    u.respond(ok({ status: 'NEW' }));
    await u.call(ORG_TESTS_RPC.attach, { runId: RUN });
    u.respond(ok({ status: 'NEW' }));
    expect((await u.call(ORG_TESTS_RPC.attach, { runId: RUN, name: 'Named_Now' })).run.definition).toBe('Named_Now');
  });

  it('ignores unrecognised statuses and never regresses a terminal one', async () => {
    const t = setup();
    await started(t);
    t.respond(ok({ status: 'IN_PROGRESS' }));
    t.respond(ok(results([], 'FAILURE')));
    expect((await t.call(ORG_TESTS_RPC.run, { runId: RUN })).run.status).toBe('in_progress');
    t.respond(ok({ status: null }));
    t.respond(ok({ status: null, testCases: [] }));
    expect((await t.call(ORG_TESTS_RPC.run, { runId: RUN })).run.status).toBe('in_progress');
    t.respond(ok({ status: 'COMPLETED' }));
    t.respond(ok(results([], 'IN_PROGRESS')));
    const done = await t.call(ORG_TESTS_RPC.run, { runId: RUN });
    expect(done.run.status).toBe('completed');
    expect((await t.call(ORG_TESTS_RPC.runs)).runs[0].status).toBe('completed');
  });

  it('keeps a cancel that lands while a get is in flight', async () => {
    const t = setup();
    await started(t);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    t.respond(ok({ status: 'IN_PROGRESS' }));
    t.sdk.request.mockImplementationOnce(async () => { await gate; return { org: org(), response: { status: 200, json: { status: 'IN_PROGRESS' }, text: '' } }; });
    t.respond(ok(results([], 'IN_PROGRESS')));
    const pending = t.call(ORG_TESTS_RPC.run, { runId: RUN });
    await new Promise(resolve => setTimeout(resolve, 5));
    t.respond(ok({}));
    await t.call(ORG_TESTS_RPC.cancel, { runId: RUN });
    release();
    const reply = await pending;
    expect(reply.run.status).toBe('terminated');
    expect((await t.call(ORG_TESTS_RPC.runs)).runs[0].status).toBe('terminated');
  });

  it('bounds metric text, metric count and stored result bytes', () => {
    const long = 'z'.repeat(5000);
    const metrics = Array.from({ length: 30 }, (_, i) => ({ name: `m${i}`, expectedValue: long, actualValue: long, metricExplainability: long, errorMessage: long }));
    const mapped = mapRunResults({ status: 'COMPLETED', testCases: [{ status: 'COMPLETED', testResults: metrics }] });
    const row = mapped.cases[0]!;
    expect(row.metrics).toHaveLength(ORG_TESTS_LIMITS.metrics);
    expect(row.metrics[0]!.expected).toHaveLength(ORG_TESTS_LIMITS.metricText);
    expect(row.metrics[0]!.explanation).toHaveLength(ORG_TESTS_LIMITS.metricText);
    expect(row.metrics[0]!.error).toHaveLength(ORG_TESTS_LIMITS.metricText);

    const run = { cases: Array.from({ length: 200 }, () => ({ ...row, utterance: long, reply: long })) };
    expect(boundResults({ cases: [row] })).toEqual({ cases: [row] });
    for (const max of [1_500_000, 400_000, 100_000, 5_000]) {
      const bounded = boundResults(run, max);
      expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(max);
    }
    expect(boundResults(run, 400_000).cases.length).toBeGreaterThan(0);
    expect(boundResults({ cases: [{ ...row, metrics: [] }] }, 10).cases).toEqual([]);
  });

  it('a terminal run reports pending 0 from its actual cases', async () => {
    const t = setup();
    await t.call(ORG_TESTS_RPC.definition, { name: 'Billing_Test' });
    await started(t);
    t.respond(ok({ status: 'COMPLETED' }));
    t.respond(ok(results([{ status: 'COMPLETED', inputs: { utterance: 'a' }, testNumber: 1, testResults: [] }])));
    expect((await t.call(ORG_TESTS_RPC.run, { runId: RUN })).run.counts).toEqual({ total: 1, pass: 1, fail: 0, error: 0, pending: 0 });
  });

  it('orders and retains by when a run was added, not the org start time', async () => {
    const t = setup();
    for (let i = 0; i < ORG_TESTS_LIMITS.storedRuns; i++) {
      t.respond(ok({ id: `E${String(i).padStart(14, '0')}` }));
      await t.call(ORG_TESTS_RPC.start, { name: 'Fill' });
    }
    t.respond(ok({ status: 'COMPLETED', startTime: '2001-01-01T00:00:00Z' }));
    t.respond(ok(results([])));
    const attached = await t.call(ORG_TESTS_RPC.attach, { runId: RUN, name: 'Old_One' });
    expect(attached.run.startedAt).toBe(Date.parse('2001-01-01T00:00:00Z'));
    const { runs } = await t.call(ORG_TESTS_RPC.runs);
    expect(runs).toHaveLength(ORG_TESTS_LIMITS.storedRuns);
    expect(runs[0].runId).toBe(RUN);
    expect([...t.kvMap.keys()].some(k => k.endsWith(`orgTests:result:${RUN}`))).toBe(true);
  });
});
