import { readFile, stat } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { EVAL_RUNS_PATH, evalResultsPath, evalRunPath, extractEvalRunId, evalRunStatus } from './agent.js';
import { compactError } from './dx-project.js';
import { removeTemp, retrieveInto, tempProject } from './org-retrieve.js';
import {
  ORG_TESTS_CHANGED_KIND, ORG_TESTS_LIMITS, ORG_TESTS_RPC, caseVerdict, isOrgRunTerminal, orgRunStatus, parseOrgRunStatus, runCounts,
  type OrgCaseResult, type OrgMetricResult, type OrgRunRecord, type OrgRunResults, type OrgRunStatus, type OrgTestCase,
  type OrgTestDefinition, type OrgTestDefinitionSummary,
} from './org-tests-contract.js';
import { rpcFailure, rpcString, type StudioServerContext } from './studio-server-context.js';
import { STUDIO_CHANGED_CHANNEL } from './studio-contract.js';
import { EVAL_API_VERSION, type PublicOrgView } from './types.js';
import type { SalesforceSdk } from './sdk-contract.js';

export interface OrgTestsDeps {
  /** The sdk for this call: Studio read grants applied (a production org without a grant answers `refused`). */
  sdkFor(args: unknown): SalesforceSdk;
  /** Overrides for tests. */
  listTtlMs?: number;
  retrieveTimeoutMs?: number;
}

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const RUN_ID = /^[A-Za-z0-9]{15,18}$/;
const LIST_TTL_MS = 5 * 60_000;
/** Parsed definitions kept in memory; a details batch fills it, so opening a just-listed test needs no second retrieve. */
const DEFINITION_CACHE = 60;
/** Summaries kept across orgs: a few large orgs' worth of definitions. */
const SUMMARY_CACHE = 5_000;
/** Summaries stored per org, so a reload lists agents without retrieving every definition again. */
const STORED_SUMMARIES = 2_000;
/** Org-wide, not per project: one org's definitions are the same whichever project lists them. */
const keySummaries = (org: string) => `orgTests:summaries:${org}`;
const RETRIEVE_TIMEOUT_MS = 120_000;
const KEY_RUNS = 'orgTests:runs';
const keyResult = (runId: string) => `orgTests:result:${runId}`;

class OrgTestsError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const rec = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max: number = ORG_TESTS_LIMITS.text): string => {
  const raw = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  return raw.length > max ? raw.slice(0, max) : raw;
};

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** Decodes the XML/HTML entities Salesforce leaves in metadata and eval payloads, once. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try { return String.fromCodePoint(code); } catch { return whole; }
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}
const clean = (value: unknown, max: number = ORG_TESTS_LIMITS.text) => decodeEntities(text(value, max * 2)).slice(0, max);

const ARRAY_TAGS = new Set(['testCase', 'expectation', 'contextVariable', 'conversationHistory']);

/** Parses an AiEvaluationDefinition metadata file. Throws OrgTestsError('invalid_definition') for non-definition XML. */
export function parseDefinitionXml(xml: string, name: string): OrgTestDefinition {
  let root: Record<string, unknown>;
  try {
    const parsed = new XMLParser({
      ignoreAttributes: true, processEntities: false, parseTagValue: false, trimValues: true,
      isArray: tag => ARRAY_TAGS.has(tag),
    }).parse(xml) as Record<string, unknown>;
    root = rec(parsed.AiEvaluationDefinition);
    if (!parsed.AiEvaluationDefinition || typeof parsed.AiEvaluationDefinition !== 'object') throw Error('missing root');
  } catch {
    throw new OrgTestsError('invalid_definition', `${name} is not a readable AI evaluation definition.`);
  }
  const rows = Array.isArray(root.testCase) ? root.testCase : [];
  const testCases: OrgTestCase[] = rows.slice(0, ORG_TESTS_LIMITS.cases).map((row, index) => {
    const testCase = rec(row);
    const inputs = rec(testCase.inputs);
    const history = (Array.isArray(inputs.conversationHistory) ? inputs.conversationHistory : []).map((item, at) => {
      const turn = rec(item);
      const index = Number(turn.index);
      return { at, order: Number.isFinite(index) ? index : at, role: String(turn.role ?? '').trim().toLowerCase() === 'user' ? 'user' as const : 'agent' as const, message: clean(turn.message ?? turn.utterance) };
    });
    history.sort((a, b) => a.order - b.order || a.at - b.at);
    const number = Number(testCase.number);
    return {
      number: Number.isFinite(number) && number > 0 ? number : index + 1,
      utterance: clean(inputs.utterance),
      conversationHistory: history.map(({ role, message }) => ({ role, message })),
      contextVariables: (Array.isArray(inputs.contextVariable) ? inputs.contextVariable : []).map(item => {
        const variable = rec(item);
        return { name: clean(variable.variableName, 200), value: clean(variable.variableValue) };
      }).filter(variable => variable.name),
      expectations: (Array.isArray(testCase.expectation) ? testCase.expectation : []).map(item => {
        const expectation = rec(item);
        const expected = expectation.expectedValue;
        return { name: clean(expectation.name, 200), ...(expected === undefined ? {} : { expectedValue: clean(expected) }) };
      }).filter(expectation => expectation.name),
    };
  });
  const label = clean(root.name, 300) || name;
  return {
    name, label,
    ...(root.subjectName ? { subjectName: clean(root.subjectName, 300) } : {}),
    ...(root.subjectType ? { subjectType: clean(root.subjectType, 100) } : {}),
    ...(root.subjectVersion ? { subjectVersion: clean(root.subjectVersion, 100) } : {}),
    caseCount: rows.length,
    testCases,
    ...(rows.length > ORG_TESTS_LIMITS.cases ? { truncated: true } : {}),
  };
}

const parseActions = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' || typeof item === 'number').map(item => clean(item, 300)).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  const raw = decodeEntities(value).trim();
  try {
    const parsed: unknown = JSON.parse(raw.replace(/'/g, '"'));
    if (Array.isArray(parsed)) return parsed.map(item => clean(item, 300)).filter(Boolean);
  } catch { /* fall through to splitting */ }
  return raw.replace(/^\[|\]$/g, '').split(',').map(part => part.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).slice(0, 100);
};

const metricResult = (value: unknown): 'pass' | 'fail' | null => {
  const result = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (result === 'PASS' || result === 'PASSED') return 'pass';
  if (result === 'FAILURE' || result === 'FAIL' || result === 'FAILED') return 'fail';
  return null;
};

/** Maps the org's run results payload to per-case rows with verdicts. */
export function mapRunResults(payload: unknown): { status: OrgRunStatus; startTime?: string; endTime?: string; errorMessage?: string; subjectName?: string; cases: OrgCaseResult[] } {
  const root = rec(payload);
  const status = orgRunStatus(root.status);
  const cases = (Array.isArray(root.testCases) ? root.testCases : []).slice(0, ORG_TESTS_LIMITS.cases).map((row, index): OrgCaseResult => {
    const item = rec(row);
    const generated = rec(item.generatedData);
    const caseStatus = orgRunStatus(item.status);
    const metrics = (Array.isArray(item.testResults) ? item.testResults : []).slice(0, ORG_TESTS_LIMITS.metrics).map((entry): OrgMetricResult => {
      const metric = rec(entry);
      const score = typeof metric.score === 'number' && Number.isFinite(metric.score) ? metric.score : undefined;
      const metricStatus = metric.status === undefined || metric.status === null ? undefined : orgRunStatus(metric.status);
      const explanation = clean(metric.metricExplainability, ORG_TESTS_LIMITS.metricText);
      const error = clean(metric.errorMessage ?? metric.errorCode, ORG_TESTS_LIMITS.metricText);
      return {
        name: clean(metric.name, 200),
        ...(metric.expectedValue !== undefined && metric.expectedValue !== null ? { expected: clean(metric.expectedValue, ORG_TESTS_LIMITS.metricText) } : {}),
        ...(metric.actualValue !== undefined && metric.actualValue !== null ? { actual: clean(metric.actualValue, ORG_TESTS_LIMITS.metricText) } : {}),
        ...(score !== undefined ? { score } : {}),
        result: metricResult(metric.result),
        ...(explanation ? { explanation } : {}),
        ...(metricStatus ? { status: metricStatus } : {}),
        ...(error ? { error } : {}),
      };
    });
    const number = Number(item.testNumber);
    const base = {
      number: Number.isFinite(number) && number > 0 ? number : index + 1,
      utterance: clean(rec(item.inputs).utterance),
      status: caseStatus,
      ...(generated.topic ? { topic: clean(generated.topic, 300) } : {}),
      actions: parseActions(generated.actionsSequence ?? generated.invokedActions),
      ...(generated.outcome ? { reply: clean(generated.outcome) } : {}),
      ...(generated.sessionId ? { sessionId: clean(generated.sessionId, 200) } : {}),
      ...(typeof item.startTime === 'string' ? { startTime: item.startTime } : {}),
      ...(typeof item.endTime === 'string' ? { endTime: item.endTime } : {}),
      metrics,
    };
    return { ...base, verdict: caseVerdict({ status: caseStatus, metrics }) };
  });
  return {
    status,
    ...(typeof root.startTime === 'string' ? { startTime: root.startTime } : {}),
    ...(typeof root.endTime === 'string' ? { endTime: root.endTime } : {}),
    ...(root.errorMessage ? { errorMessage: clean(root.errorMessage, 1000) } : {}),
    ...(root.subjectName ? { subjectName: clean(root.subjectName, 300) } : {}),
    cases,
  };
}

const runRecords = (value: unknown): OrgRunRecord[] => Array.isArray(value) ? value.filter(row => rec(row).runId && rec(row).definition) as OrgRunRecord[] : [];
const toRecord = (run: OrgRunResults): OrgRunRecord => { const { cases: _cases, ...record } = run; return record; };

const TRIM_STEPS: Array<{ metric: number; reply: number }> = [{ metric: 300, reply: 1_000 }, { metric: 100, reply: 300 }, { metric: 0, reply: 100 }];
/** Trims a run's text until its JSON fits ORG_TESTS_LIMITS.resultBytes; drops trailing cases as a last resort. */
export function boundResults<T extends { cases: OrgCaseResult[] }>(run: T, maxBytes: number = ORG_TESTS_LIMITS.resultBytes): T {
  const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
  if (size(run) <= maxBytes) return run;
  const cut = (value: string | undefined, max: number) => value === undefined ? undefined : value.slice(0, max);
  let next = run;
  for (const step of TRIM_STEPS) {
    next = { ...run, cases: run.cases.map(row => ({
      ...row,
      utterance: cut(row.utterance, step.reply)!,
      ...(row.reply !== undefined ? { reply: cut(row.reply, step.reply)! } : {}),
      metrics: row.metrics.map(metric => ({
        ...metric,
        ...(metric.expected !== undefined ? { expected: cut(metric.expected, step.metric)! } : {}),
        ...(metric.actual !== undefined ? { actual: cut(metric.actual, step.metric)! } : {}),
        ...(metric.explanation !== undefined ? { explanation: cut(metric.explanation, step.metric)! } : {}),
        ...(metric.error !== undefined ? { error: cut(metric.error, step.metric)! } : {}),
      })),
    })) };
    if (size(next) <= maxBytes) return next;
  }
  const cases = [...next.cases];
  while (cases.length > 0 && size({ ...next, cases }) > maxBytes) cases.length = Math.floor(cases.length / 2);
  return { ...next, cases };
}

const historyOrder = (row: OrgRunRecord) => row.addedAt ?? row.startedAt;

type StoredSummary = Pick<OrgTestDefinitionSummary, 'label' | 'subjectName' | 'subjectType' | 'subjectVersion' | 'caseCount' | 'lastModified'>;
const summaryFields = ({ lastModified: _version, ...fields }: StoredSummary) => fields;
/** A stored summary as read back from storage, or null when it is not one. */
function storedSummary(value: unknown): StoredSummary | null {
  const row = rec(value);
  const str = (key: string, max: number) => typeof row[key] === 'string' && row[key] ? { [key]: (row[key] as string).slice(0, max) } : {};
  if (typeof row.subjectName !== 'string' || !row.subjectName) return null;
  const caseCount = Number(row.caseCount);
  return {
    ...str('label', 300), ...str('subjectName', 300), ...str('subjectType', 100), ...str('subjectVersion', 100), ...str('lastModified', 40),
    ...(Number.isInteger(caseCount) && caseCount >= 0 ? { caseCount } : {}),
  };
}

export function registerOrgTests(studio: StudioServerContext, deps: OrgTestsDeps): void {
  const { zcc } = studio;
  const kv = zcc.storage.kv;
  const ttl = deps.listTtlMs ?? LIST_TTL_MS;
  const listCache = new Map<string, { at: number; definitions: OrgTestDefinitionSummary[] }>();
  const definitions = new Map<string, OrgTestDefinition>();
  /** What a retrieve told us about each definition, keyed `${org}\n${name}`; the list rows are enriched from it. */
  const summaries = new Map<string, StoredSummary>();
  /** The lastModifiedDate the latest list reported per `${org}\n${name}`; a summary read from an older version is dropped. */
  const versions = new Map<string, string>();
  const remember = (key: string, definition: OrgTestDefinition) => {
    summaries.delete(key);
    const lastModified = versions.get(key);
    summaries.set(key, { label: definition.label, subjectName: definition.subjectName, subjectType: definition.subjectType, subjectVersion: definition.subjectVersion, caseCount: definition.caseCount ?? definition.testCases.length, ...(lastModified ? { lastModified } : {}) });
    while (summaries.size > SUMMARY_CACHE) summaries.delete(summaries.keys().next().value!);
  };
  const keep = (key: string, definition: OrgTestDefinition) => {
    definitions.delete(key);
    definitions.set(key, definition);
    while (definitions.size > DEFINITION_CACHE) definitions.delete(definitions.keys().next().value!);
    remember(key, definition);
  };
  /** Orgs whose stored summaries are loaded into memory (once per org and plugin start). */
  const hydrated = new Map<string, Promise<void>>();
  const hydrate = (org: string) => {
    let loading = hydrated.get(org);
    if (!loading) {
      loading = (async () => {
        const stored = rec(await kv.get<unknown>(keySummaries(org)).catch(() => undefined));
        for (const [name, row] of Object.entries(rec(stored.rows))) {
          const summary = storedSummary(row);
          const key = `${org}\n${name}`;
          if (summary && NAME.test(name) && !summaries.has(key)) summaries.set(key, summary);
        }
      })();
      hydrated.set(org, loading);
    }
    return loading;
  };
  let persisting: Promise<unknown> = Promise.resolve();
  /** Stores this org's summaries, newest last and bounded; writes queue so an older snapshot never lands after a newer one. */
  const persist = (org: string) => {
    const write = async () => {
      const prefix = `${org}\n`;
      const rows = [...summaries].filter(([key]) => key.startsWith(prefix)).slice(-STORED_SUMMARIES);
      await kv.set(keySummaries(org), { rows: Object.fromEntries(rows.map(([key, row]) => [key.slice(prefix.length), row])) });
    };
    const next = persisting.then(write, write);
    persisting = next.catch(() => undefined);
    return next.catch(() => undefined);
  };
  let chain: Promise<unknown> = Promise.resolve();
  /** Serializes read-modify-write of the stored history (one in-process queue). */
  const locked = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  };
  const projectId = () => studio.contexts.current()?.projectId ?? '';
  const changed = (runId: string) => { try { zcc.realtime.publish(STUDIO_CHANGED_CHANNEL, { projectId: projectId(), kind: ORG_TESTS_CHANGED_KIND, runId }); } catch { /* realtime is best effort */ } };

  const guard = (handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    try { return await handler(args); } catch (error) {
      if (error instanceof OrgTestsError) return rpcFailure(error.code, error.message);
      return rpcFailure('failed', error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400));
    }
  };

  /** Connects the org and passes the same read mediation the other Studio org reads use. */
  const access = async (args: unknown, summary: string, alias?: string, write = false) => {
    const sdk = deps.sdkFor(args);
    const org = await sdk.connect(alias ? { alias } : undefined);
    // Starting or cancelling spends the org's eval capacity: on a production or unknown org it confirms as org.write,
    // which no read grant satisfies. Other orgs run without a prompt, as an org read does.
    const kind = write && (org.kind === 'production' || org.kind === 'unknown') ? 'org.write' as const : undefined;
    const mediated = await sdk.confirm({ orgAlias: org.alias, orgId: org.orgId, orgKind: org.kind, ...(kind ? { kind } : {}), summary: `${summary} on ${org.alias} (${org.kind})` }, rpcString(args, 'threadId'));
    if (!mediated.approved) throw new OrgTestsError('refused', `Operator ${mediated.reason} ${summary}.`);
    return { sdk, org };
  };
  const orgView = (org: PublicOrgView) => ({ alias: org.alias, id: org.orgId, isProduction: org.kind === 'production' });
  const apiFail = (response: { status: number; json: unknown; text: string }) => new OrgTestsError('api_error', compactError(response.status, response.json, response.text));
  const cacheKey = (org: PublicOrgView) => `${org.orgId || org.alias}`;

  /**
   * Retrieves the named definitions in one retrieve and parses each. A definition the org did not return is absent;
   * one too large or unreadable maps to its error, so a batch still yields the others.
   */
  const retrieveDefinitions = async (sdk: SalesforceSdk, org: PublicOrgView, names: string[]) => {
    const out = new Map<string, OrgTestDefinition | OrgTestsError>();
    let project: string | undefined;
    try {
      // AiEvaluationDefinition needs API 63.0+; an older org default silently retrieves nothing.
      const apiVersion = Number(org.apiVersion) >= Number(EVAL_API_VERSION) ? org.apiVersion! : EVAL_API_VERSION;
      project = await tempProject(apiVersion, 'zcc-sf-orgtest-');
      // Source format through retrieveInto, the retrieve already proven in the app; --target-metadata-dir leaves no file there.
      const retrieved = await retrieveInto(sdk.execSf.bind(sdk), project, names.map(name => `AiEvaluationDefinition:${name}`), {
        alias: org.alias, apiVersion, timeoutMs: deps.retrieveTimeoutMs ?? RETRIEVE_TIMEOUT_MS,
      }).catch((error: unknown) => { throw new OrgTestsError('cli_error', error instanceof Error ? error.message : String(error)); });
      for (const name of names) {
        const file = retrieved.files.find(row => row.type === 'AiEvaluationDefinition' && row.fullName === name)?.path;
        if (!file) continue;
        try {
          const size = (await stat(file)).size;
          if (size > ORG_TESTS_LIMITS.definitionBytes) throw new OrgTestsError('too_large', `${name} is larger than ${Math.round(ORG_TESTS_LIMITS.definitionBytes / 1_000_000)} MB.`);
          out.set(name, parseDefinitionXml((await readFile(file)).toString('utf8'), name));
        } catch (error) {
          out.set(name, error instanceof OrgTestsError ? error : new OrgTestsError('invalid_definition', error instanceof Error ? error.message : String(error)));
        }
      }
      return out;
    } finally {
      await removeTemp(project).catch(() => undefined);
    }
  };

  const readRuns = async () => runRecords(await kv.get<unknown>(studio.contexts.key(KEY_RUNS)));
  /**
   * Stores a run in the history inside the lock. The stored record is re-read here: a terminal status already stored
   * (a cancel that landed meanwhile) is never reverted. Returns the record as stored.
   */
  const saveRun = (run: OrgRunResults | OrgRunRecord) => locked(async () => {
    const key = studio.contexts.key(KEY_RUNS);
    const list = runRecords(await kv.get<unknown>(key));
    const current = list.find(row => row.runId === run.runId);
    const incoming = 'cases' in run ? toRecord(run) : run;
    const record: OrgRunRecord = {
      ...incoming,
      addedAt: current ? historyOrder(current) : incoming.addedAt ?? studio.deps.now(),
      ...(current && isOrgRunTerminal(current.status) ? { status: current.status, ...(current.endedAt !== undefined ? { endedAt: current.endedAt } : {}) } : {}),
    };
    const next = [record, ...list.filter(row => row.runId !== record.runId)].sort((a, b) => historyOrder(b) - historyOrder(a));
    const dropped = next.slice(ORG_TESTS_LIMITS.storedRuns);
    await kv.set(key, next.slice(0, ORG_TESTS_LIMITS.storedRuns));
    const stored = 'cases' in run ? { ...record, cases: run.cases } : record;
    if ('cases' in run && isOrgRunTerminal(record.status) && !dropped.some(row => row.runId === record.runId)) await kv.set(studio.contexts.key(keyResult(record.runId)), boundResults(stored as OrgRunResults));
    for (const old of dropped) await kv.delete(studio.contexts.key(keyResult(old.runId))).catch(() => undefined);
    return stored;
  });

  const parseId = (args: unknown) => {
    const runId = rpcString(args, 'runId');
    if (!RUN_ID.test(runId)) throw new OrgTestsError('invalid_input', 'runId must be an evaluation run id (15 or 18 letters and digits).');
    return runId;
  };
  const parseName = (args: unknown) => {
    const name = rpcString(args, 'name');
    if (!NAME.test(name)) throw new OrgTestsError('invalid_input', 'name must be an AI evaluation definition API name (letters, digits and underscores).');
    return name;
  };

  /** Status (and, when it has begun, results) of a run, mapped; the stored record is the base. */
  const fetchRun = async (sdk: SalesforceSdk, base: OrgRunRecord, alias: string): Promise<OrgRunResults> => {
    const status = await sdk.request(evalRunPath(base.runId), { method: 'GET', apiVersion: EVAL_API_VERSION, alias });
    if (status.response.status >= 400) throw apiFail(status.response);
    const reported = parseOrgRunStatus(evalRunStatus(status.response.json));
    let runStatus: OrgRunStatus = reported ?? base.status;
    let mapped = { cases: [] as OrgCaseResult[], errorMessage: undefined as string | undefined, subjectName: undefined as string | undefined, endTime: undefined as string | undefined };
    if (runStatus !== 'new') {
      const results = await sdk.request(evalResultsPath(base.runId), { method: 'GET', apiVersion: EVAL_API_VERSION, alias });
      if (results.response.status < 400) {
        const full = mapRunResults(results.response.json);
        mapped = { cases: full.cases, errorMessage: full.errorMessage, subjectName: full.subjectName, endTime: full.endTime };
        // Only a recognised results status counts, and it never moves a terminal status back.
        const fromResults = parseOrgRunStatus(rec(results.response.json).status);
        if (fromResults && !(isOrgRunTerminal(runStatus) && !isOrgRunTerminal(fromResults))) runStatus = fromResults;
      } else if (isOrgRunTerminal(runStatus)) throw apiFail(results.response);
    }
    if (isOrgRunTerminal(base.status) && !isOrgRunTerminal(runStatus)) runStatus = base.status;
    const ended = isOrgRunTerminal(runStatus);
    const began = Date.parse(String(rec(status.response.json).startTime ?? ''));
    const message = mapped.errorMessage ?? (typeof rec(status.response.json).errorMessage === 'string' ? clean(rec(status.response.json).errorMessage, 1000) : undefined);
    const record: OrgRunRecord = {
      ...base, status: runStatus,
      ...(base.startedBy === 'attached' && Number.isFinite(began) ? { startedAt: began } : {}),
      ...(mapped.subjectName && !base.subjectName ? { subjectName: mapped.subjectName } : {}),
      ...(ended ? { endedAt: base.endedAt ?? studio.deps.now() } : {}),
      counts: runCounts(mapped.cases, ended ? mapped.cases.length : Math.max(base.counts?.total ?? 0, mapped.cases.length)),
      ...(message ? { errorMessage: message } : {}),
    };
    return boundResults({ ...record, cases: mapped.cases });
  };

  studio.registerRpc(ORG_TESTS_RPC.list, guard(async args => {
    const { sdk, org } = await access(args, 'orgTests.list');
    const key = cacheKey(org);
    await hydrate(key);
    const refresh = Boolean(rec(args).refresh);
    let entry = listCache.get(key);
    if (!entry || refresh || studio.deps.now() - entry.at > ttl) {
      const result = await sdk.execSf(['org', 'list', 'metadata', '-m', 'AiEvaluationDefinition', '--json', '--target-org', org.alias], { timeoutMs: 60_000 });
      let payload: Record<string, unknown> = {};
      try { payload = rec(JSON.parse(result.stdout)); } catch { /* handled below */ }
      if (result.code !== 0 || payload.status !== 0) throw new OrgTestsError('cli_error', typeof payload.message === 'string' ? payload.message.slice(0, 400) : 'Salesforce could not list the evaluation definitions. Check your org access and retry.');
      const rows = Array.isArray(payload.result) ? payload.result : payload.result ? [payload.result] : [];
      const found: OrgTestDefinitionSummary[] = [];
      for (const row of rows) {
        const item = rec(row);
        const name = typeof item.fullName === 'string' ? item.fullName : '';
        if (!NAME.test(name)) continue;
        found.push({
          name,
          ...(typeof item.createdByName === 'string' ? { createdBy: item.createdByName } : {}),
          ...(typeof item.lastModifiedDate === 'string' ? { lastModified: item.lastModifiedDate } : {}),
        });
      }
      found.sort((a, b) => (b.lastModified ?? '').localeCompare(a.lastModified ?? '') || a.name.localeCompare(b.name));
      entry = { at: studio.deps.now(), definitions: found };
      listCache.set(key, entry);
      // A definition edited since its summary was read is read again; one never compared takes the listed version.
      let stale = false;
      for (const row of found) {
        const at = `${key}\n${row.name}`;
        if (row.lastModified) versions.set(at, row.lastModified);
        const known = summaries.get(at);
        if (!known || !row.lastModified || known.lastModified === row.lastModified) continue;
        if (known.lastModified) { summaries.delete(at); definitions.delete(at); } else summaries.set(at, { ...known, lastModified: row.lastModified });
        stale = true;
      }
      if (stale) await persist(key);
    }
    const enriched = entry.definitions.map(summary => {
      const known = summaries.get(`${key}\n${summary.name}`);
      return known ? { ...summary, ...summaryFields(known) } : summary;
    });
    return { ok: true, org: orgView(org), definitions: enriched, at: entry.at };
  }));

  studio.registerRpc(ORG_TESTS_RPC.definition, guard(async args => {
    const name = parseName(args);
    const { sdk, org } = await access(args, 'orgTests.definition');
    await hydrate(cacheKey(org));
    const key = `${cacheKey(org)}\n${name}`;
    const cached = definitions.get(key);
    if (cached && !rec(args).refresh) return { ok: true, definition: cached };
    const read = (await retrieveDefinitions(sdk, org, [name])).get(name);
    if (!read) throw new OrgTestsError('not_found', `${name} was not found in ${org.alias}.`);
    if (read instanceof OrgTestsError) throw read;
    keep(key, read);
    await persist(cacheKey(org));
    return { ok: true, definition: read };
  }));

  studio.registerRpc(ORG_TESTS_RPC.details, guard(async args => {
    const raw = rec(args).names;
    const names = Array.isArray(raw) ? [...new Set(raw)] : [];
    if (!names.length || names.length > ORG_TESTS_LIMITS.detailsBatch || !names.every(name => typeof name === 'string' && NAME.test(name))) {
      throw new OrgTestsError('invalid_input', `names must be 1 to ${ORG_TESTS_LIMITS.detailsBatch} AI evaluation definition API names.`);
    }
    const { sdk, org } = await access(args, 'orgTests.details');
    const prefix = cacheKey(org);
    await hydrate(prefix);
    const wanted = (names as string[]).filter(name => rec(args).refresh || !summaries.has(`${prefix}\n${name}`));
    if (wanted.length) {
      for (const [name, read] of await retrieveDefinitions(sdk, org, wanted)) if (!(read instanceof OrgTestsError)) keep(`${prefix}\n${name}`, read);
      await persist(prefix);
    }
    const found: OrgTestDefinitionSummary[] = [];
    const missing: string[] = [];
    for (const name of names as string[]) {
      const known = summaries.get(`${prefix}\n${name}`);
      if (known) found.push({ name, ...summaryFields(known) }); else missing.push(name);
    }
    return { ok: true, definitions: found, missing };
  }));

  studio.registerRpc(ORG_TESTS_RPC.start, guard(async args => {
    const name = parseName(args);
    const threadId = rpcString(args, 'threadId');
    const { sdk, org } = await access(args, `orgTests.run ${name}`, undefined, true);
    const created = await sdk.request(EVAL_RUNS_PATH, { method: 'POST', body: { aiEvaluationDefinitionName: name }, apiVersion: EVAL_API_VERSION, alias: org.alias });
    if (created.response.status >= 400) throw apiFail(created.response);
    const runId = extractEvalRunId(created.response.json);
    if (!runId || !RUN_ID.test(runId)) throw new OrgTestsError('api_error', 'The org did not return a run id.');
    const known = definitions.get(`${cacheKey(org)}\n${name}`);
    const run: OrgRunRecord = {
      runId, definition: name, ...(known?.subjectName ? { subjectName: known.subjectName } : {}),
      orgId: org.orgId, orgAlias: org.alias, status: orgRunStatus(evalRunStatus(created.response.json)),
      startedAt: studio.deps.now(), startedBy: rpcString(args, 'via') === 'studio' ? 'studio' : threadId ? 'thread' : 'studio', ...(threadId ? { threadId } : {}),
      ...(known ? { counts: runCounts([], known.caseCount ?? known.testCases.length) } : {}),
    };
    const saved = await saveRun(run);
    changed(runId);
    return { ok: true, run: saved };
  }));

  studio.registerRpc(ORG_TESTS_RPC.run, guard(async args => {
    const runId = parseId(args);
    const stored = (await readRuns()).find(row => row.runId === runId);
    if (!stored) throw new OrgTestsError('not_found', 'This run is not in the history. Attach it by id first.');
    if (isOrgRunTerminal(stored.status)) {
      const cached = await kv.get<OrgRunResults>(studio.contexts.key(keyResult(runId)));
      if (cached && Array.isArray(cached.cases)) return { ok: true, run: cached };
    }
    const { sdk } = await access(args, 'orgTests.result', stored.orgAlias);
    const fetched = await fetchRun(sdk, stored, stored.orgAlias);
    const run = await saveRun(fetched) as OrgRunResults;
    if (run.status !== stored.status || (run.counts?.pass ?? 0) !== (stored.counts?.pass ?? 0)) changed(runId);
    return { ok: true, run };
  }));

  studio.registerRpc(ORG_TESTS_RPC.cancel, guard(async args => {
    const runId = parseId(args);
    const stored = (await readRuns()).find(row => row.runId === runId);
    if (!stored) throw new OrgTestsError('not_found', 'This run is not in the history.');
    if (isOrgRunTerminal(stored.status)) return { ok: true, run: stored };
    const { sdk } = await access(args, 'orgTests.cancel', stored.orgAlias, true);
    const response = await sdk.request(`${evalRunPath(runId)}/cancel`, { method: 'POST', apiVersion: EVAL_API_VERSION, alias: stored.orgAlias });
    if (response.response.status >= 400) throw apiFail(response.response);
    const run: OrgRunRecord = { ...stored, status: 'terminated', endedAt: studio.deps.now() };
    const saved = await saveRun(run);
    changed(runId);
    return { ok: true, run: saved };
  }));

  studio.registerRpc(ORG_TESTS_RPC.runs, guard(async args => {
    const name = rpcString(args, 'name');
    const runs = (await readRuns()).filter(row => !name || row.definition === name).sort((a, b) => historyOrder(b) - historyOrder(a));
    return { ok: true, runs };
  }));

  studio.registerRpc(ORG_TESTS_RPC.attach, guard(async args => {
    const runId = parseId(args);
    const rawName = rpcString(args, 'name');
    if (rawName && !NAME.test(rawName)) throw new OrgTestsError('invalid_input', 'name must be an AI evaluation definition API name.');
    const { sdk, org } = await access(args, 'orgTests.attach');
    const existing = (await readRuns()).find(row => row.runId === runId);
    const base: OrgRunRecord = existing && existing.orgId === org.orgId
      ? { ...existing, ...(rawName && existing.definition === 'unknown' ? { definition: rawName } : {}) }
      : { runId, definition: rawName || 'unknown', orgId: org.orgId, orgAlias: org.alias, status: 'new', startedAt: studio.deps.now(), startedBy: 'attached' };
    const fetched = await fetchRun(sdk, base, org.alias);
    const run = await saveRun(fetched);
    changed(runId);
    return { ok: true, run };
  }));
}
