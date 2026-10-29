/**
 * Unified Preview server side (WS-6): agentLab.trace and saved scenario suites.
 * Suites live in the repo as tests/<Agent>.scenario.json (written through the same confined,
 * sha-checked path discipline as agentFiles.write); last results live in plugin kv (bounded).
 * A suite also exports to tests/<Agent>.eval.yaml for `sf agent test run-eval`, imports
 * JSON or YAML specs, and backs the bounded "Make these pass" fix loop.
 */
import { SuiteJobs } from './suite-jobs.js';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { AgentFilesError, sha256Hex } from './agent-files.js';
import { resolveUnderRoot } from './dx-project.js';
import { agentSuitePath } from './graph-coverage.js';
import { EvalSpecError, GENERATED_SPEC_MARKER, evalSpecCases, suiteToEvalSpec } from './eval-spec.js';
import { extraAssertions, parseExtraAssertions } from './scenario-assertions.js';
import { parsePreviewContext } from './preview-context.js';
import { FixLoopError, FixLoops, type FixLoop } from './fix-loop.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type CaseObserved, type CaseOutcome, type CaseResult, type ScenarioCase, type ScenarioSuite, type SuiteComparison, type TraceStep, type SuiteEval, type SuiteProgress, type TurnTrace } from './studio-contract.js';
import { rpcFailure, rpcString, type RpcFailure, type StudioServerContext } from './studio-server-context.js';
import { labRecord, type LabEngine, type LabScenario } from './agentforce-lab-contract.js';
import type { AgentforceLab } from './agentforce-lab.js';
import type { SalesforceDeps } from './types.js';

export const SUITE_LIMITS = { cases: 50, utterances: 8, text: 4000, runCases: 50, comparisonCases: 20, stored: 40, fileBytes: 256_000 } as const;
const SUITE_PATH = /^tests\/[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.scenario\.json$/;
const SPEC_PATH = /^tests\/[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.eval\.yaml$/;
const SUFFIX = '.scenario.json';
type Outcome = CaseOutcome;
export type SuiteResults = NonNullable<ScenarioSuite['lastResults']>;
export interface SuiteEntry extends ScenarioSuite { sha256: string }
export interface CaseRunDetail extends CaseResult { caseId: string; notes: string[]; turns: Array<{ role: 'user' | 'agent'; text: string }> }
/** Per-case evidence kept in kv: up to 40 suites × 50 cases, with at most 12,000 transcript characters per case. */
export const EVIDENCE_LIMITS = { notes: 5, note: 240, reply: 480, names: 10, name: 100, conversationChars: 12000, conversationTurns: 16, message: 4000 } as const;

/** The stored form of a run: outcome, bounded conversation and check evidence. */
export function caseResult(detail: CaseRunDetail): CaseResult {
  const names = (values: string[]) => values.slice(0, EVIDENCE_LIMITS.names).map(value => value.slice(0, EVIDENCE_LIMITS.name));
  const reply = [...detail.turns].reverse().find(turn => turn.role === 'agent')?.text.trim().slice(0, EVIDENCE_LIMITS.reply);
  const conversation: NonNullable<CaseResult['conversation']> = [];
  let remaining: number = EVIDENCE_LIMITS.conversationChars;
  for (const turn of detail.turns.slice(0, EVIDENCE_LIMITS.conversationTurns)) {
    if (remaining <= 0) break;
    const message = turn.text.slice(0, Math.min(EVIDENCE_LIMITS.message, remaining));
    conversation.push({ role: turn.role, message });
    remaining -= message.length;
  }
  const conversationTruncated = conversation.length < detail.turns.length || conversation.some((turn, i) => turn.message.length < detail.turns[i]!.text.length);
  return {
    outcome: detail.outcome, runId: detail.runId, at: detail.at,
    ...(detail.notes.length ? { notes: detail.notes.slice(0, EVIDENCE_LIMITS.notes).map(note => note.slice(0, EVIDENCE_LIMITS.note)) } : {}),
    ...(detail.observed ? { observed: { topics: names(detail.observed.topics), actions: names(detail.observed.actions), traced: detail.observed.traced, ...(detail.observed.traceComplete !== undefined ? { traceComplete: detail.observed.traceComplete } : {}) } } : {}),
    ...(reply ? { reply } : {}),
    ...(conversation.length ? { conversation, ...(conversationTruncated ? { conversationTruncated: true } : {}) } : {}),
    ...(detail.setupBlocked ? { setupBlocked: true } : {}),
    ...(detail.stopped ? { stopped: true } : {}),
    ...(detail.deterministic ? { deterministic: detail.deterministic } : {}),
    ...(detail.judge ? { judge: detail.judge } : {}),
    ...(detail.sourceHash ? { sourceHash: detail.sourceHash, caseHash: detail.caseHash } : {}),
    ...(detail.latencyMs !== undefined ? { latencyMs: detail.latencyMs } : {}),
    ...(detail.assertions ? { assertions: detail.assertions } : {}),
    ...(detail.history ? { history: detail.history } : {})
  };
}

export function suitePathForAgent(agentPath: string): string {
  const path = agentSuitePath(agentPath);
  if (!path) throw new AgentFilesError('invalid_input', 'Cannot derive a scenario file name from this agent.');
  return path;
}

/** The generated `sf agent test` spec beside a suite. */
export function specPathForSuite(suitePath: string): string {
  return suitePath.replace(/\.scenario\.json$/, '.eval.yaml');
}

/** Strict lexical check, then realpath checks on whatever already exists so symlinks cannot leave the root. */
export function confineSuitePath(root: string, candidate: string, deps: Pick<SalesforceDeps, 'realpath' | 'stat'>, kind: 'suite' | 'spec' = 'suite'): string {
  const rel = candidate.trim();
  if (!(kind === 'spec' ? SPEC_PATH : SUITE_PATH).test(rel)) {
    throw new AgentFilesError('path_refused', kind === 'spec' ? 'Eval specs live at tests/<Name>.eval.yaml inside the project.' : 'Scenario suites live at tests/<Name>.scenario.json inside the project.');
  }
  const realRoot = deps.realpath(root);
  if (deps.stat(join(realRoot, 'tests')) !== 'missing') {
    const dir = resolveUnderRoot(realRoot, 'tests', deps.realpath);
    if (!dir || deps.stat(dir) !== 'dir') throw new AgentFilesError('path_refused', 'The tests folder must stay inside the project.');
  }
  const absolute = join(realRoot, rel);
  if (deps.stat(absolute) !== 'missing' && !resolveUnderRoot(realRoot, rel, deps.realpath)) throw new AgentFilesError('path_refused', 'Scenario path resolves outside the project.');
  return absolute;
}

const text = (v: unknown, max: number = SUITE_LIMITS.text) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function strings(v: unknown, max: number, each: number = SUITE_LIMITS.text): string[] {
  return Array.isArray(v) ? v.map(x => text(x, each)).filter(Boolean).slice(0, max) : [];
}

export function parseScenarioCase(value: unknown, index: number): ScenarioCase {
  const row = labRecord(value);
  const utterances = strings(row.utterances, SUITE_LIMITS.utterances);
  if (!utterances.length) throw new AgentFilesError('invalid_input', `Case ${index + 1} needs at least one utterance.`);
  const expect = labRecord(row.expect);
  const topic = text(expect.topic, 200);
  const actions = strings(expect.actions, 20, 200);
  const contains = strings(expect.contains, 20, 500);
  const criteria = text(expect.criteria);
  const pinned = labRecord(row.pinned);
  const runId = text(pinned.runId, 80);
  return {
    id: text(row.id, 80).replace(/[^A-Za-z0-9_.-]/g, '_') || `case-${index + 1}`,
    ...(row.contextVariables !== undefined ? { contextVariables: parsePreviewContext(row.contextVariables) } : {}),
    ...(Array.isArray(row.prerequisites) && row.prerequisites.length ? { prerequisites: strings(row.prerequisites, 10, 500) } : {}),
    name: text(row.name, 200) || `Case ${index + 1}`,
    utterances,
    expect: { ...(topic ? { topic } : {}), ...(actions.length ? { actions } : {}), ...(Array.isArray(expect.forbiddenActions) ? { forbiddenActions: strings(expect.forbiddenActions, 20, 200) } : {}), ...(contains.length ? { contains } : {}), ...(criteria ? { criteria } : {}), ...parseExtraAssertions(expect) },
    ...(runId && Number.isFinite(pinned.at) ? { pinned: { runId, at: Number(pinned.at) } } : {})
  };
}

export function parseScenarioCases(value: unknown): ScenarioCase[] {
  if (!Array.isArray(value) || !value.length || value.length > SUITE_LIMITS.cases) throw new AgentFilesError('invalid_input', `A suite needs 1-${SUITE_LIMITS.cases} cases.`);
  const cases = value.map(parseScenarioCase);
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new AgentFilesError('invalid_input', 'Scenario case ids must be unique.');
  return cases;
}

/** Deterministic checks first; AI criteria only add a verdict. Topic/action expectations need a runtime trace. */
export function judgeCase(expect: ScenarioCase['expect'], observed: { agentText: string; topics: string[]; actions: string[]; traced: boolean; traceComplete?: boolean }, ai?: { outcome: Outcome; reason: string }): { outcome: Outcome; notes: string[] } {
  const notes: string[] = [];
  let outcome: Outcome = 'pass';
  const worsen = (next: Outcome) => { if (next === 'fail' || (next === 'inconclusive' && outcome === 'pass')) outcome = next; };
  let checks = 0;
  const lower = observed.agentText.toLowerCase();
  for (const needle of expect.contains ?? []) {
    checks++;
    if (!lower.includes(needle.toLowerCase())) { worsen('fail'); notes.push(`Missing text: "${needle}"`); }
  }
  if (expect.topic || expect.actions?.length || expect.forbiddenActions?.length) {
    if (!observed.traced || observed.traceComplete === false) { worsen('inconclusive'); notes.push('Topic/action checks need a Simulate runtime trace.'); }
    else {
      if (expect.topic) { checks++; if (!observed.topics.includes(expect.topic)) { worsen('fail'); notes.push(`Topic "${expect.topic}" not entered (saw ${observed.topics.join(', ') || 'none'}).`); } }
      for (const action of expect.actions ?? []) { checks++; if (!observed.actions.includes(action)) { worsen('fail'); notes.push(`Action "${action}" not called.`); } }
    }
  }
  for (const action of expect.forbiddenActions ?? []) {
    checks++;
    if (observed.traceComplete !== true) { worsen('inconclusive'); if (!notes.includes('Complete runtime trace required for forbidden actions.')) notes.push('Complete runtime trace required for forbidden actions.'); }
    if (observed.actions.includes(action) || action === '*' && observed.actions.length) { worsen('fail'); notes.push(`Forbidden action "${action}" called.`); }
  }
  if (expect.criteria) {
    checks++;
    if (!ai) { worsen('inconclusive'); notes.push('Criteria could not be evaluated.'); }
    else { if (ai.outcome !== 'pass') worsen(ai.outcome); notes.push(`AI: ${ai.reason}`.slice(0, 400)); }
  }
  if (!checks && outcome === 'pass') { outcome = 'inconclusive'; notes.push('No expectations to check.'); }
  return { outcome, notes };
}

interface Kv { get<T>(key: string): Promise<T | undefined | null>; set(key: string, value: unknown): Promise<void> }

/** What the plugin's eval runner answers: the org it ran on and, when the CLI said, one outcome per spec case. */
export type SuiteEvalReply =
  | { ok: true; summary?: string; data: { passed: boolean; orgId: string; orgAlias?: string; orgKind?: string; botVersionId?: string; caseOutcomes?: Outcome[] | null } }
  | { ok: false; code?: string; error?: string };

export class ScenarioSuites {
  private chains = new Map<string, Promise<unknown>>();
  private running = new Set<string>();
  private progress = new Map<string, { path: string; value: SuiteProgress }>();
  constructor(private readonly o: {
    deps: Pick<SalesforceDeps, 'realpath' | 'stat' | 'readFile' | 'readdir' | 'writeFile'>;
    kv: Kv; lab: Pick<AgentforceLab, 'start' | 'send' | 'trace' | 'evaluate' | 'end'>;
    root(): string; project(): string; now(): number; changed?(payload: Record<string, unknown>): void;
  }) {}

  private serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.chains.set(key, next);
    void next.finally(() => { if (this.chains.get(key) === next) this.chains.delete(key); }).catch(() => undefined);
    return next;
  }
  private resultsKey() { return `studio:suites:${this.o.project() || 'global'}`; }
  private evalsKey() { return `studio:suite-evals:${this.o.project() || 'global'}`; }
  private async results(): Promise<Record<string, SuiteResults>> { return (await this.o.kv.get<Record<string, SuiteResults>>(this.resultsKey())) ?? {}; }
  private async evals(): Promise<Record<string, SuiteEval>> { return (await this.o.kv.get<Record<string, SuiteEval>>(this.evalsKey())) ?? {}; }
  private updateProgress(lock: string, path: string, value: SuiteProgress | null): void {
    if (value) this.progress.set(lock, { path, value });
    else this.progress.delete(lock);
    this.o.changed?.({ path, kind: 'suite-progress' });
  }
  /** Newest last, at most SUITE_LIMITS.stored suites per project. */
  private async storeBounded<T>(key: string, read: () => Promise<Record<string, T>>, suiteId: string, value: T): Promise<void> {
    await this.serial(key, async () => {
      const all = await read();
      delete all[suiteId];
      all[suiteId] = value;
      const keys = Object.keys(all);
      for (const old of keys.slice(0, Math.max(0, keys.length - SUITE_LIMITS.stored))) delete all[old];
      await this.o.kv.set(key, all);
    });
  }
  private storeResults(suiteId: string, results: SuiteResults): Promise<void> {
    return this.storeBounded(this.resultsKey(), () => this.results(), suiteId, Object.fromEntries(Object.entries(results).slice(-SUITE_LIMITS.cases)));
  }

  private parseFile(path: string, raw: string, all: Record<string, SuiteResults>, evals: Record<string, SuiteEval>): SuiteEntry | null {
    try {
      const body = labRecord(JSON.parse(raw));
      const id = basename(path, SUFFIX);
      return { id, path, cases: parseScenarioCases(body.cases), ...(all[id] ? { lastResults: all[id] } : {}), ...(evals[id] ? { lastEval: evals[id] } : {}), sha256: sha256Hex(raw) };
    } catch { return null; }
  }

  async list(agentPath?: string): Promise<SuiteEntry[]> {
    const root = this.o.root();
    const dir = join(root, 'tests');
    if (this.o.deps.stat(dir) !== 'dir') return [];
    const all = await this.results();
    const evals = await this.evals();
    const wanted = agentPath ? suitePathForAgent(agentPath) : null;
    const out: SuiteEntry[] = [];
    for (const name of this.o.deps.readdir(dir).sort().slice(0, 200)) {
      const path = `tests/${name}`;
      if (!SUITE_PATH.test(path) || (wanted && path !== wanted)) continue;
      const abs = confineSuitePath(root, path, this.o.deps);
      const raw = this.o.deps.readFile(abs);
      const parsed = raw !== null && raw.length <= SUITE_LIMITS.fileBytes ? this.parseFile(path, raw, all, evals) : null;
      if (parsed) {
        const project = this.o.project() || 'global';
        const active = [this.progress.get(project), this.progress.get(`eval:${project}`)].find(run => run?.path === path);
        out.push(active ? { ...parsed, progress: active.value } : parsed);
      }
    }
    return out;
  }

  async save(input: { path?: string; agentPath?: string; cases: unknown; expectedSha256?: string }): Promise<SuiteEntry> {
    const path = input.path?.trim() || (input.agentPath ? suitePathForAgent(input.agentPath) : '');
    if (!path) throw new AgentFilesError('invalid_input', 'save requires a suite path or agentPath.');
    const cases = parseScenarioCases(input.cases);
    return this.serial(`file:${path}`, async () => {
      const abs = confineSuitePath(this.o.root(), path, this.o.deps);
      const existing = this.o.deps.stat(abs) === 'missing' ? null : (this.o.deps.readFile(abs) ?? '');
      if (existing !== null && input.expectedSha256 !== sha256Hex(existing)) throw new AgentFilesError('sha_mismatch', 'The scenario file changed on disk. Reload before saving.');
      if (existing === null && input.expectedSha256 && input.expectedSha256 !== sha256Hex('')) throw new AgentFilesError('sha_mismatch', 'The scenario file no longer exists. Reload before saving.');
      const content = `${JSON.stringify({ version: 1, ...(input.agentPath ? { agent: input.agentPath } : {}), cases }, null, 2)}\n`;
      if (content.length > SUITE_LIMITS.fileBytes) throw new AgentFilesError('invalid_input', 'Scenario suite is too large.');
      this.o.deps.writeFile(abs, content);
      this.o.changed?.({ path, kind: 'suites' });
      const id = basename(path, SUFFIX);
      const all = await this.results();
      const evals = await this.evals();
      return { id, path, cases, ...(all[id] ? { lastResults: all[id] } : {}), ...(evals[id] ? { lastEval: evals[id] } : {}), sha256: sha256Hex(content) };
    });
  }

  /** Adds a JSON or YAML spec's cases to the agent's suite; clashing ids get a suffix. */
  async importSpec(input: { agentPath: string; text: string }): Promise<{ suite: SuiteEntry; imported: number }> {
    let rows: Array<Record<string, unknown>>;
    try { rows = evalSpecCases(input.text); } catch (error) {
      if (error instanceof EvalSpecError) throw new AgentFilesError('invalid_input', error.message);
      throw error;
    }
    const existing = (await this.list(input.agentPath))[0] ?? null;
    const taken = new Set(existing?.cases.map(c => c.id) ?? []);
    const added = rows.map(row => {
      const base = String(row.id);
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      return { ...row, id };
    });
    const suite = await this.save({ agentPath: input.agentPath, cases: [...(existing?.cases ?? []), ...added], ...(existing ? { expectedSha256: existing.sha256 } : {}) });
    return { suite, imported: added.length };
  }

  /** Writes tests/<Agent>.eval.yaml from the agent's suite. A spec someone else wrote is never overwritten. */
  async writeSpec(input: { agentPath: string; apiName: string; source?: string }): Promise<{ suite: SuiteEntry; specPath: string; absolute: string; text: string; multiTurn: string[] }> {
    const suite = (await this.list(input.agentPath))[0];
    if (!suite) throw new AgentFilesError('not_found', 'This agent has no scenario suite yet. Add a case first.');
    const unprepared = suite.cases.filter(c => c.prerequisites?.length && (!suite.lastResults?.[c.id] || suite.lastResults[c.id]!.setupBlocked || suite.lastResults[c.id]!.caseHash !== sha256Hex(JSON.stringify(c)) || input.source && suite.lastResults[c.id]!.sourceHash !== sha256Hex(input.source)));
    if (unprepared.length) throw new AgentFilesError('invalid_input', `Prepare and run these cases in Simulate before exporting an org replay: ${unprepared.map(c => c.name).join(', ')}.`);
    const specPath = specPathForSuite(suite.path);
    const replay = Object.fromEntries(suite.cases.flatMap(c => {
      const result = suite.lastResults?.[c.id];
      return result?.history && result.caseHash === sha256Hex(JSON.stringify(c)) && (!input.source || result.sourceHash === sha256Hex(input.source)) ? [[c.id, result.history]] : [];
    }));
    const { text: spec, multiTurn } = suiteToEvalSpec(suite.cases, { apiName: input.apiName, name: suite.id, from: suite.path }, replay);
    return this.serial(`file:${specPath}`, async () => {
      const absolute = confineSuitePath(this.o.root(), specPath, this.o.deps, 'spec');
      if (this.o.deps.stat(absolute) !== 'missing' && !(this.o.deps.readFile(absolute) ?? '').startsWith(GENERATED_SPEC_MARKER)) {
        throw new AgentFilesError('path_refused', `${specPath} was not written by the Studio. Rename it, or run it with sf_agent eval.run.`);
      }
      this.o.deps.writeFile(absolute, spec);
      return { suite, specPath, absolute, text: spec, multiTurn };
    });
  }

  /** Runs the suite's spec against the org's published agent and keeps the outcome per case. One eval per project at a time. */
  async evaluate(input: { agentPath: string; apiName: string; source?: string }, runEval: (spec: { absolute: string; specPath: string; text: string }) => Promise<SuiteEvalReply>): Promise<{ suite: SuiteEntry; lastEval: SuiteEval; summary?: string } | RpcFailure> {
    const lock = `eval:${this.o.project() || 'global'}`;
    if (this.running.has(lock)) throw new AgentFilesError('invalid_input', 'An org eval is already running for this project.');
    this.running.add(lock);
    try {
      const written = await this.writeSpec(input);
      this.updateProgress(lock, written.suite.path, { id: randomUUID(), mode: 'org-eval', startedAt: this.o.now(), caseIds: written.suite.cases.map(c => c.id), completed: 0, stage: 'org-eval', results: {} });
      const reply = await runEval(written);
      if (!reply.ok) return rpcFailure(reply.code || 'eval_failed', reply.error || 'The org eval failed.');
      const { suite } = written;
      const outcomes = Array.isArray(reply.data.caseOutcomes) ? reply.data.caseOutcomes : null;
      const fallback: Outcome = reply.data.passed ? 'pass' : 'inconclusive';
      const lastEval: SuiteEval = {
        at: this.o.now(), org: reply.data.orgAlias || reply.data.orgId, orgId: reply.data.orgId, passed: reply.data.passed, specPath: written.specPath,
        ...(reply.data.botVersionId ? { botVersionId: reply.data.botVersionId } : {}),
        perCase: Boolean(outcomes),
        results: Object.fromEntries(suite.cases.map((c, index) => [c.id, { outcome: outcomes?.[index] ?? fallback }])),
        multiTurn: written.multiTurn, historyReplay: true
      };
      await this.storeBounded(this.evalsKey(), () => this.evals(), suite.id, lastEval);
      this.o.changed?.({ path: suite.path, kind: 'suites' });
      return { suite: { ...suite, lastEval }, lastEval, ...(reply.summary ? { summary: reply.summary } : {}) };
    } finally {
      this.running.delete(lock);
      this.updateProgress(lock, suitePathForAgent(input.agentPath), null);
    }
  }

  /**
   * Sequential, one run per project, every case ends its lab session (the lab owns the 12-session / 50-call budgets).
   * `store: false` keeps the results out of the suite: a proposal or fix-loop candidate is not the file on disk.
   */
  async run(input: { path: string; source: string; engine: LabEngine; model?: string; caseIds?: string[]; agentPath?: string; threadId?: string; store?: boolean; startedByUser?: boolean; referenceSource?: string; signal?: AbortSignal; preparedCaseIds?: string[] }): Promise<{ suite: SuiteEntry; results: SuiteResults; details: CaseRunDetail[]; comparison?: SuiteComparison }> {
    const lock = this.o.project() || 'global';
    if (this.running.has(lock)) throw new AgentFilesError('invalid_input', 'A suite is already running for this project.');
    this.running.add(lock);
    try {
      const suite = (await this.list()).find(s => s.path === input.path);
      if (!suite) throw new AgentFilesError('not_found', `Scenario suite not found: ${input.path}`);
      if (input.referenceSource !== undefined && suite.cases.length > SUITE_LIMITS.comparisonCases) throw new AgentFilesError('invalid_input', `Comparisons support at most ${SUITE_LIMITS.comparisonCases} cases. Split this suite before comparing.`);
      const cases = suite.cases.filter(c => !input.caseIds?.length || input.caseIds.includes(c.id)).slice(0, SUITE_LIMITS.runCases);
      if (!cases.length) throw new AgentFilesError('invalid_input', 'No matching cases to run.');
      const results: SuiteResults = input.store === false || input.referenceSource !== undefined ? {} : { ...(suite.lastResults ?? {}) };
      const reference: SuiteResults = {};
      const details: CaseRunDetail[] = [];
      let progress: SuiteProgress = { id: randomUUID(), mode: input.referenceSource !== undefined ? 'compare' : input.store === false ? 'proposal' : 'simulate', startedAt: this.o.now(), caseIds: cases.map(c => c.id), completed: 0, stage: 'starting', results: {} };
      const update = (patch: Partial<SuiteProgress>) => {
        progress = { ...progress, ...patch };
        this.updateProgress(lock, suite.path, progress);
      };
      if (input.referenceSource !== undefined) {
        update({ comparisonPhase: 'reference' });
        for (const c of cases) {
          input.signal?.throwIfAborted();
          update({ currentCaseId: c.id, stage: 'starting', turn: 0, totalTurns: c.utterances.length });
          reference[c.id] = caseResult(await this.runCase(c, { ...input, source: input.referenceSource }, update));
          update({ completed: Object.keys(reference).length, results: { ...reference } });
        }
        update({ comparisonPhase: 'candidate', completed: 0, results: {} });
      }
      for (const c of cases) {
        input.signal?.throwIfAborted();
        update({ currentCaseId: c.id, stage: 'starting', turn: 0, totalTurns: c.utterances.length });
        const detail = await this.runCase(c, input, update);
        details.push(detail);
        results[c.id] = caseResult(detail);
        if (input.store !== false && input.referenceSource === undefined) await this.storeResults(suite.id, results);
        update({ completed: details.length, results: { ...progress.results, [c.id]: results[c.id]! } });
      }
      input.signal?.throwIfAborted();
      update({ stage: 'saving', currentCaseId: undefined });
      if (input.referenceSource !== undefined) return { suite, results, details, comparison: {
        referenceHash: sha256Hex(input.referenceSource), candidateHash: sha256Hex(input.source), suiteHash: sha256Hex(JSON.stringify(cases)), at: this.o.now(), reference, candidate: results
      } };
      if (input.store === false) return { suite, results, details };
      await this.storeResults(suite.id, results);
      this.o.changed?.({ path: suite.path, kind: 'suites' });
      return { suite: { ...suite, lastResults: results }, results, details };
    } finally {
      this.running.delete(lock);
      this.updateProgress(lock, input.path, null);
    }
  }

  private async runCase(c: ScenarioCase, input: { source: string; engine: LabEngine; model?: string; agentPath?: string; threadId?: string; startedByUser?: boolean; signal?: AbortSignal; preparedCaseIds?: string[] }, update: (patch: Partial<SuiteProgress>) => void): Promise<CaseRunDetail> {
    const { lab } = this.o;
    const scenario: LabScenario = {
      persona: 'A scripted test customer.', goal: c.name, opening: c.utterances[0]!,
      criteria: c.expect.criteria ?? 'Respond helpfully and stay in scope.', maxTurns: Math.min(c.utterances.length, 8)
    };
    let id = '';
    const detail: CaseRunDetail = { sourceHash: sha256Hex(input.source), caseHash: sha256Hex(JSON.stringify(c)), caseId: c.id, outcome: 'inconclusive', runId: '', at: this.o.now(), notes: [], turns: [] };
    if (c.prerequisites?.length && !input.preparedCaseIds?.includes(c.id)) {
      detail.setupBlocked = true;
      detail.notes = [`Setup required: ${c.prerequisites.join('; ')}. Confirm setup before replay; this is not a product failure.`];
      return detail;
    }
    const cancel = () => { if (id) { try { lab.end({ id }); } catch { /* expired */ } } };
    input.signal?.addEventListener('abort', cancel, { once: true });
    try {
      input.signal?.throwIfAborted();
      const started = await lab.start({ engine: input.engine, source: input.source, scenario, ...(c.contextVariables ? { contextVariables: c.contextVariables } : {}), ...(input.model ? { model: input.model } : {}), ...(input.threadId ? { threadId: input.threadId } : {}), ...(input.agentPath ? { path: input.agentPath } : {}), ...(input.startedByUser ? { startedByUser: true } : {}) });
      id = detail.runId = started.id;
      input.signal?.throwIfAborted();
      let last = started;
      for (const [index, utterance] of c.utterances.slice(0, scenario.maxTurns).entries()) {
        input.signal?.throwIfAborted();
        update({ stage: 'conversation', turn: index + 1 });
        last = await lab.send({ id, text: utterance });
        detail.turns = last.turns.slice(Math.max(0, last.turns.findIndex(t => t.role === 'user'))).map(t => ({ role: t.role, text: t.text }));
        input.signal?.throwIfAborted();
      }
      // A runtime may greet on start. Only replies to the scripted user turns
      // have response latency and belong in the evaluation replay history.
      const conversation = last.turns.slice(Math.max(0, last.turns.findIndex(t => t.role === 'user')));
      detail.turns = conversation.map(t => ({ role: t.role, text: t.text }));
      const responses = conversation.filter((t, index) => t.role === 'agent' && conversation[index - 1]?.role === 'user');
      const topics = new Set<string>(); const actions = new Set<string>();
      let traced = false;
      let completeTrace = input.engine === 'preview';
      const steps: TraceStep[] = [];
      const topicByPlan = new Map<string, string>();
      if (input.engine === 'preview') {
        update({ stage: 'trace' });
        const plans = responses.filter(t => t.planId).map(t => t.planId!);
        for (const planId of plans) {
          const trace: TurnTrace = await lab.trace({ id, planId, ...(input.agentPath ? { path: input.agentPath } : {}) });
          if (!trace.available) { completeTrace = false; continue; }
          if (trace.truncated) completeTrace = false;
          traced = true;
          steps.push(...trace.steps);
          const topic = trace.steps.filter(s => s.kind === 'topic').at(-1)?.label;
          if (topic && !trace.truncated) topicByPlan.set(planId, topic);
          for (const step of trace.steps) { if (step.kind === 'topic') topics.add(step.label); if (step.kind === 'action') actions.add(step.label); }
        }
      }
      let ai: { outcome: Outcome; reason: string } | undefined;
      if (c.expect.criteria) {
        update({ stage: 'judging' });
        try { const v = (await lab.evaluate({ id })).verdict; ai = { outcome: v.outcome, reason: v.reason }; } catch { /* leaves criteria inconclusive */ }
      }
      const agentTurns = responses;
      if (agentTurns.some(t => !t.planId)) completeTrace = false;
      const latencies = agentTurns.map(t => t.latencyMs);
      if (latencies.length && latencies.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) detail.latencyMs = Math.max(...latencies as number[]);
      const history = conversation.slice(0, -2).map(t => ({ role: t.role, message: t.text, ...(t.role === 'agent' && t.planId && topicByPlan.has(t.planId) ? { topic: topicByPlan.get(t.planId)! } : {}) }));
      if (c.utterances.length > 1 && history.length === (c.utterances.length - 1) * 2 && history.every((t, i) => t.role === (i % 2 ? 'agent' : 'user') && t.message.length <= 4000 && (t.role === 'user' || t.topic)) && JSON.stringify(history).length <= 12000) detail.history = history;
      detail.assertions = extraAssertions(c.expect, steps, latencies, completeTrace);
      detail.observed = { topics: [...topics], actions: [...actions], traced, traceComplete: completeTrace && traced };
      const deterministic = judgeCase({ ...c.expect, criteria: undefined }, { agentText: responses.map(t => t.text).join('\n'), topics: [...topics], actions: [...actions], traced, traceComplete: completeTrace && traced });
      detail.deterministic = deterministic.outcome;
      if (ai) detail.judge = ai.outcome;
      Object.assign(detail, judgeCase(c.expect, { agentText: responses.map(t => t.text).join('\n'), topics: [...topics], actions: [...actions], traced, traceComplete: completeTrace && traced }, ai));
      if (detail.assertions.length && detail.notes.includes('No expectations to check.')) { detail.notes = detail.notes.filter(n => n !== 'No expectations to check.'); detail.outcome = 'pass'; }
      if (detail.assertions.length && deterministic.notes.includes('No expectations to check.')) detail.deterministic = 'pass';
      for (const assertion of detail.assertions) {
        if (assertion.outcome === 'fail' || assertion.outcome === 'inconclusive' && detail.deterministic === 'pass') detail.deterministic = assertion.outcome;
        if (assertion.outcome === 'fail' || assertion.outcome === 'inconclusive' && detail.outcome === 'pass') detail.outcome = assertion.outcome;
        if (assertion.outcome !== 'pass') detail.notes.push(`${assertion.label}: ${assertion.actual}`);
      }
      input.signal?.throwIfAborted();
    } catch (error) {
      if (input.signal?.aborted) detail.stopped = true;
      detail.notes.push(error instanceof Error ? error.message : String(error));
    } finally {
      input.signal?.removeEventListener('abort', cancel);
      if (id) { try { lab.end({ id }); } catch { /* already expired */ } }
    }
    detail.at = this.o.now();
    return detail;
  }
}

/** A failure an option callback returned, carried through `guard`. */
class Refused extends Error {
  constructor(readonly failure: RpcFailure) { super(failure.error); }
}

function failure(error: unknown) {
  if (error instanceof Refused) return error.failure;
  if (error instanceof AgentFilesError || error instanceof FixLoopError) return rpcFailure(error.code, error.message);
  return rpcFailure('failed', error instanceof Error ? error.message : String(error));
}

export interface StudioPreviewOptions {
  /** The agent at a project-relative path: its API name and the source on disk. */
  agent?(path: string): Promise<{ apiName: string; source: string } | RpcFailure>;
  /** Runs a written spec with `sf agent test run-eval` against the project org. */
  runEval?(spec: { absolute: string; specPath: string; text: string; apiName: string }): Promise<SuiteEvalReply>;
  /** Fix-loop ids; random unless a test pins them. */
  loopId?(): string;
}

/** What the agent should do after a fix-loop run. */
export function loopNext(loop: FixLoop | null): string {
  if (!loop) return 'This fix loop is gone. Stop and report what you changed.';
  const last = loop.attempts.at(-1);
  const left = loop.budget - loop.attempts.length;
  if (loop.status === 'passed') return `All ${loop.caseIds.length} cases pass. Propose this source with ui.command editor.proposeEdit, then stop.`;
  if (loop.status === 'exhausted') return `No attempts left (${last?.pass ?? 0} of ${loop.caseIds.length} pass). Propose your best candidate with ui.command editor.proposeEdit and say which cases still fail.`;
  if (loop.status !== 'running') return `This fix loop is ${loop.status}. Stop and report what you changed.`;
  return `${left} attempt${left === 1 ? '' : 's'} left. Still failing: ${(last?.failing ?? loop.caseIds).join(', ')}.`;
}

/** agentLab.trace + studio.suites.list / save / run / import / spec / eval + studio.loop.start / get / stop. */
export function registerStudioPreview(studio: StudioServerContext, options: StudioPreviewOptions = {}): void {
  const project = () => studio.contexts.current()?.projectId ?? '';
  const publish = (payload: Record<string, unknown>) => studio.zcc.realtime.publish(STUDIO_CHANGED_CHANNEL, { projectId: project(), ...payload });
  const suites = new ScenarioSuites({
    deps: studio.deps, kv: studio.zcc.storage.kv, lab: studio.lab,
    root: () => studio.contexts.current()?.settings.projectRoot ?? '',
    project,
    now: () => studio.deps.now(),
    changed: publish
  });
  const jobs = new SuiteJobs(() => studio.deps.now());
  studio.zcc.onDispose(() => jobs.dispose());
  const loops = new FixLoops({ now: () => studio.deps.now(), id: options.loopId ?? (() => randomUUID()) });
  const guard = async (work: () => Promise<unknown>) => {
    try { return await work(); } catch (error) { return failure(error); }
  };
  const agentAt = async (path: string) => {
    if (!path) throw new AgentFilesError('invalid_input', 'Pick an agent file first.');
    if (!options.agent) throw new AgentFilesError('not_configured', 'Agent files are not available here.');
    const found = await options.agent(path);
    if ('ok' in found) throw new Refused(found);
    return found;
  };
  const caseIdsOf = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string').slice(0, SUITE_LIMITS.cases) : undefined;

  studio.registerRpc(STUDIO_RPC.trace, args => guard(async () => ({ ok: true, data: await studio.lab.trace(args) })));
  studio.registerRpc(STUDIO_RPC.suites, args => guard(async () => ({ ok: true, suites: await suites.list(rpcString(args, 'agentPath') || undefined), job: jobs.latest(project()) })));
  studio.registerRpc(STUDIO_RPC.suiteSave, args => guard(async () => {
    const row = labRecord(args);
    return { ok: true, suite: await suites.save({ path: rpcString(args, 'path') || undefined, agentPath: rpcString(args, 'agentPath') || undefined, cases: row.cases, expectedSha256: rpcString(args, 'expectedSha256') || undefined }) };
  }));
  studio.registerRpc(STUDIO_RPC.suiteImport, args => guard(async () => {
    const agentPath = rpcString(args, 'agentPath');
    const spec = labRecord(args).text;
    if (!agentPath || typeof spec !== 'string') throw new AgentFilesError('invalid_input', 'import requires agentPath and the spec text.');
    return { ok: true, ...await suites.importSpec({ agentPath, text: spec }) };
  }));
  studio.registerRpc(STUDIO_RPC.suiteSpec, args => guard(async () => {
    const agentPath = rpcString(args, 'agentPath');
    const { apiName, source } = await agentAt(agentPath);
    const { specPath, multiTurn, text: spec } = await suites.writeSpec({ agentPath, apiName, source });
    return { ok: true, specPath, multiTurn, text: spec };
  }));
  studio.registerRpc(STUDIO_RPC.suiteEval, args => guard(async () => {
    if (!options.runEval) throw new AgentFilesError('not_configured', 'Org evals are not available here.');
    const agentPath = rpcString(args, 'agentPath');
    const { apiName, source } = await agentAt(agentPath);
    const result = await suites.evaluate({ agentPath, apiName, source }, spec => options.runEval!({ ...spec, apiName }));
    return 'ok' in result ? result : { ok: true, ...result };
  }));
  const compareSuite = (args: unknown, signal?: AbortSignal) => guard(async () => {
    const agentPath = rpcString(args, 'agentPath');
    const reference = await agentAt(agentPath);
    const row = labRecord(args);
    if (typeof row.source !== 'string' || !row.source.trim() || row.source.length > 10 * 1024 * 1024) throw new AgentFilesError('invalid_input', 'Provide the candidate editor source (at most 10 MB).');
    return { ok: true, ...await suites.run({ path: suitePathForAgent(agentPath), agentPath, source: row.source, referenceSource: reference.source, signal, preparedCaseIds: caseIdsOf(row.preparedCaseIds), engine: 'preview', store: false, startedByUser: row.startedByUser === true, threadId: rpcString(args, 'threadId') || undefined }) };
  });
  studio.registerRpc(STUDIO_RPC.suiteCompare, args => compareSuite(args));
  const runSuite = (args: unknown, signal?: AbortSignal) => guard(async () => {
    const row = labRecord(args);
    const agentPath = rpcString(args, 'agentPath');
    const loopId = rpcString(args, 'loopId');
    let source = typeof row.source === 'string' ? row.source : '';
    // An agent may run the saved file; the Studio always sends its editor source.
    if (!source.trim() && agentPath && options.agent) source = (await agentAt(agentPath)).source;
    if (!source.trim()) throw new AgentFilesError('invalid_input', 'run requires the agent source.');
    const loop = loopId ? loops.claim(project(), loopId, agentPath) : null;
    const run = await suites.run({
      path: loop?.suitePath ?? (rpcString(args, 'path') || (agentPath ? suitePathForAgent(agentPath) : '')),
      source,
      // A fix loop spends Simulate runs only, and never stores a candidate's results as the file's.
      engine: loop ? 'preview' : row.engine === 'rehearsal' ? 'rehearsal' : 'preview',
      model: rpcString(args, 'model') || undefined, agentPath: agentPath || undefined, threadId: rpcString(args, 'threadId') || undefined,
      signal, preparedCaseIds: caseIdsOf(row.preparedCaseIds),
      caseIds: loop ? loop.caseIds : caseIdsOf(row.caseIds),
      store: loop ? false : row.store !== false,
      // A click on Run approves its own runs; a fix loop's attempts are agent-driven, so they still ask.
      startedByUser: !loop && row.startedByUser === true
    });
    if (!loop) return { ok: true, ...run };
    const updated = loops.record(project(), loop.id, Object.fromEntries(Object.entries(run.results).map(([id, result]) => [id, result.outcome])));
    publish({ path: agentPath, kind: 'loop', loopId: loop.id });
    return { ok: true, ...run, loop: updated, next: loopNext(updated) };
  });
  studio.registerRpc(STUDIO_RPC.suiteRun, args => runSuite(args));
  studio.registerRpc(STUDIO_RPC.suiteStart, args => guard(async () => {
    const row = labRecord(args);
    return { ok: true, ...jobs.start(project(), rpcString(args, 'requestId') || undefined, sha256Hex(JSON.stringify({ ...row, requestId: undefined })), async signal => {
      const result = await (row.compare === true ? compareSuite(args, signal) : runSuite(args, signal));
      if (result && typeof result === 'object' && 'ok' in result && result.ok === false) throw Error((result as RpcFailure).error);
      return result;
    }) };
  }));
  studio.registerRpc(STUDIO_RPC.suiteResult, args => guard(async () => ({ ok: true, ...jobs.get(project(), rpcString(args, 'jobId')) })));
  studio.registerRpc(STUDIO_RPC.suiteStop, args => guard(async () => ({ ok: true, ...jobs.stop(project(), rpcString(args, 'jobId')) })));
  studio.registerRpc(STUDIO_RPC.loopStart, args => guard(async () => {
    const agentPath = rpcString(args, 'agentPath');
    const suite = agentPath ? (await suites.list(agentPath))[0] : undefined;
    if (!suite) throw new AgentFilesError('not_found', 'This agent has no scenario suite yet.');
    const known = new Set(suite.cases.map(c => c.id));
    const budget = labRecord(args).budget;
    const loop = loops.start({
      projectId: project(), agentPath, suitePath: suite.path,
      caseIds: (caseIdsOf(labRecord(args).caseIds) ?? []).filter(id => known.has(id)),
      ...(typeof budget === 'number' ? { budget } : {})
    });
    publish({ path: agentPath, kind: 'loop', loopId: loop.id });
    return { ok: true, loop };
  }));
  studio.registerRpc(STUDIO_RPC.loopGet, args => guard(async () => {
    const loopId = rpcString(args, 'loopId');
    const loop = loopId ? loops.get(project(), loopId) : loops.latest(project(), rpcString(args, 'agentPath'));
    return { ok: true, loop, ...(loop ? { next: loopNext(loop) } : {}) };
  }));
  studio.registerRpc(STUDIO_RPC.loopStop, args => guard(async () => {
    const loop = loops.stop(project(), rpcString(args, 'loopId'));
    if (!loop) throw new FixLoopError('not_found', 'This fix loop does not exist.');
    publish({ path: loop.agentPath, kind: 'loop', loopId: loop.id });
    return { ok: true, loop };
  }));
}
