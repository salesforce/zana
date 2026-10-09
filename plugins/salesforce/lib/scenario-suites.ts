/**
 * Unified Preview server side (WS-6): agentLab.trace and saved scenario suites.
 * Suites live in the repo as tests/<Agent>.scenario.json (written through the same confined,
 * sha-checked path discipline as agentFiles.write); last results live in plugin kv (bounded).
 */
import { basename, join } from 'node:path';
import { AgentFilesError, sha256Hex } from './agent-files.js';
import { resolveUnderRoot } from './dx-project.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type ScenarioCase, type ScenarioSuite, type TurnTrace } from './studio-contract.js';
import { rpcFailure, rpcString, type StudioServerContext } from './studio-server-context.js';
import { labRecord, type LabEngine, type LabScenario } from './agentforce-lab-contract.js';
import type { AgentforceLab } from './agentforce-lab.js';
import type { SalesforceDeps } from './types.js';

export const SUITE_LIMITS = { cases: 50, utterances: 8, text: 4000, runCases: 20, stored: 40, fileBytes: 256_000 } as const;
const SUITE_PATH = /^tests\/[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.scenario\.json$/;
const SUFFIX = '.scenario.json';
type Outcome = 'pass' | 'fail' | 'inconclusive';
export type SuiteResults = NonNullable<ScenarioSuite['lastResults']>;
export interface SuiteEntry extends ScenarioSuite { sha256: string }
export interface CaseRunDetail { caseId: string; outcome: Outcome; runId: string; at: number; notes: string[]; turns: Array<{ role: 'user' | 'agent'; text: string }> }

export function suitePathForAgent(agentPath: string): string {
  const name = basename(agentPath).replace(/\.(agent|afscript)$/i, '').replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z0-9]+/, '');
  if (!name) throw new AgentFilesError('invalid_input', 'Cannot derive a scenario file name from this agent.');
  return `tests/${name.slice(0, 100)}${SUFFIX}`;
}

/** Strict lexical check, then realpath checks on whatever already exists so symlinks cannot leave the root. */
export function confineSuitePath(root: string, candidate: string, deps: Pick<SalesforceDeps, 'realpath' | 'stat'>): string {
  const rel = candidate.trim();
  if (!SUITE_PATH.test(rel)) throw new AgentFilesError('path_refused', 'Scenario suites live at tests/<Name>.scenario.json inside the project.');
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
  return {
    id: text(row.id, 80).replace(/[^A-Za-z0-9_.-]/g, '_') || `case-${index + 1}`,
    name: text(row.name, 200) || `Case ${index + 1}`,
    utterances,
    expect: { ...(topic ? { topic } : {}), ...(actions.length ? { actions } : {}), ...(contains.length ? { contains } : {}), ...(criteria ? { criteria } : {}) }
  };
}

export function parseScenarioCases(value: unknown): ScenarioCase[] {
  if (!Array.isArray(value) || !value.length || value.length > SUITE_LIMITS.cases) throw new AgentFilesError('invalid_input', `A suite needs 1-${SUITE_LIMITS.cases} cases.`);
  const cases = value.map(parseScenarioCase);
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new AgentFilesError('invalid_input', 'Scenario case ids must be unique.');
  return cases;
}

/** Deterministic checks first; AI criteria only add a verdict. Topic/action expectations need a runtime trace. */
export function judgeCase(expect: ScenarioCase['expect'], observed: { agentText: string; topics: string[]; actions: string[]; traced: boolean }, ai?: { outcome: Outcome; reason: string }): { outcome: Outcome; notes: string[] } {
  const notes: string[] = [];
  let outcome: Outcome = 'pass';
  const worsen = (next: Outcome) => { if (next === 'fail' || (next === 'inconclusive' && outcome === 'pass')) outcome = next; };
  let checks = 0;
  const lower = observed.agentText.toLowerCase();
  for (const needle of expect.contains ?? []) {
    checks++;
    if (!lower.includes(needle.toLowerCase())) { worsen('fail'); notes.push(`Missing text: "${needle}"`); }
  }
  if (expect.topic || expect.actions?.length) {
    if (!observed.traced) { worsen('inconclusive'); notes.push('Topic/action checks need a Simulate runtime trace.'); }
    else {
      if (expect.topic) { checks++; if (!observed.topics.includes(expect.topic)) { worsen('fail'); notes.push(`Topic "${expect.topic}" not entered (saw ${observed.topics.join(', ') || 'none'}).`); } }
      for (const action of expect.actions ?? []) { checks++; if (!observed.actions.includes(action)) { worsen('fail'); notes.push(`Action "${action}" not called.`); } }
    }
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

export class ScenarioSuites {
  private chains = new Map<string, Promise<unknown>>();
  private running = new Set<string>();
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
  private async results(): Promise<Record<string, SuiteResults>> { return (await this.o.kv.get<Record<string, SuiteResults>>(this.resultsKey())) ?? {}; }
  private async storeResults(suiteId: string, results: SuiteResults): Promise<void> {
    await this.serial(this.resultsKey(), async () => {
      const all = await this.results();
      delete all[suiteId];
      all[suiteId] = Object.fromEntries(Object.entries(results).slice(-SUITE_LIMITS.cases));
      const keys = Object.keys(all);
      for (const key of keys.slice(0, Math.max(0, keys.length - SUITE_LIMITS.stored))) delete all[key];
      await this.o.kv.set(this.resultsKey(), all);
    });
  }

  private parseFile(path: string, raw: string, all: Record<string, SuiteResults>): SuiteEntry | null {
    try {
      const body = labRecord(JSON.parse(raw));
      const id = basename(path, SUFFIX);
      return { id, path, cases: parseScenarioCases(body.cases), ...(all[id] ? { lastResults: all[id] } : {}), sha256: sha256Hex(raw) };
    } catch { return null; }
  }

  async list(agentPath?: string): Promise<SuiteEntry[]> {
    const root = this.o.root();
    const dir = join(root, 'tests');
    if (this.o.deps.stat(dir) !== 'dir') return [];
    const all = await this.results();
    const wanted = agentPath ? suitePathForAgent(agentPath) : null;
    const out: SuiteEntry[] = [];
    for (const name of this.o.deps.readdir(dir).sort().slice(0, 200)) {
      const path = `tests/${name}`;
      if (!SUITE_PATH.test(path) || (wanted && path !== wanted)) continue;
      const abs = confineSuitePath(root, path, this.o.deps);
      const raw = this.o.deps.readFile(abs);
      const parsed = raw !== null && raw.length <= SUITE_LIMITS.fileBytes ? this.parseFile(path, raw, all) : null;
      if (parsed) out.push(parsed);
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
      return { id, path, cases, ...(all[id] ? { lastResults: all[id] } : {}), sha256: sha256Hex(content) };
    });
  }

  /** Sequential, one run per project, every case ends its lab session (the lab owns the 12-session / 50-call budgets). */
  async run(input: { path: string; source: string; engine: LabEngine; model?: string; caseIds?: string[]; agentPath?: string }): Promise<{ suite: SuiteEntry; results: SuiteResults; details: CaseRunDetail[] }> {
    const lock = this.o.project() || 'global';
    if (this.running.has(lock)) throw new AgentFilesError('invalid_input', 'A suite is already running for this project.');
    const suite = (await this.list()).find(s => s.path === input.path);
    if (!suite) throw new AgentFilesError('not_found', `Scenario suite not found: ${input.path}`);
    const cases = suite.cases.filter(c => !input.caseIds?.length || input.caseIds.includes(c.id)).slice(0, SUITE_LIMITS.runCases);
    if (!cases.length) throw new AgentFilesError('invalid_input', 'No matching cases to run.');
    this.running.add(lock);
    const results: SuiteResults = { ...(suite.lastResults ?? {}) };
    const details: CaseRunDetail[] = [];
    try {
      for (const c of cases) {
        const detail = await this.runCase(c, input);
        details.push(detail);
        results[c.id] = { outcome: detail.outcome, runId: detail.runId, at: detail.at };
      }
    } finally { this.running.delete(lock); }
    await this.storeResults(suite.id, results);
    this.o.changed?.({ path: suite.path, kind: 'suites' });
    return { suite: { ...suite, lastResults: results }, results, details };
  }

  private async runCase(c: ScenarioCase, input: { source: string; engine: LabEngine; model?: string; agentPath?: string }): Promise<CaseRunDetail> {
    const { lab } = this.o;
    const scenario: LabScenario = {
      persona: 'A scripted test customer.', goal: c.name, opening: c.utterances[0]!,
      criteria: c.expect.criteria ?? 'Respond helpfully and stay in scope.', maxTurns: Math.min(c.utterances.length, 8)
    };
    let id = '';
    const detail: CaseRunDetail = { caseId: c.id, outcome: 'inconclusive', runId: '', at: this.o.now(), notes: [], turns: [] };
    try {
      const started = await lab.start({ engine: input.engine, source: input.source, scenario, ...(input.model ? { model: input.model } : {}) });
      id = detail.runId = started.id;
      let last = started;
      for (const utterance of c.utterances.slice(0, scenario.maxTurns)) last = await lab.send({ id, text: utterance });
      detail.turns = last.turns.map(t => ({ role: t.role, text: t.text }));
      const topics = new Set<string>(); const actions = new Set<string>();
      let traced = false;
      if (input.engine === 'preview' && (c.expect.topic || c.expect.actions?.length)) {
        const plans = last.turns.filter(t => t.role === 'agent' && t.planId).map(t => t.planId!);
        for (const planId of plans) {
          const trace: TurnTrace = await lab.trace({ id, planId, ...(input.agentPath ? { path: input.agentPath } : {}) });
          if (!trace.available) continue;
          traced = true;
          for (const step of trace.steps) { if (step.kind === 'topic') topics.add(step.label); if (step.kind === 'action') actions.add(step.label); }
        }
      }
      let ai: { outcome: Outcome; reason: string } | undefined;
      if (c.expect.criteria) {
        try { const v = (await lab.evaluate({ id })).verdict; ai = { outcome: v.outcome, reason: v.reason }; } catch { /* leaves criteria inconclusive */ }
      }
      Object.assign(detail, judgeCase(c.expect, { agentText: last.turns.filter(t => t.role === 'agent').map(t => t.text).join('\n'), topics: [...topics], actions: [...actions], traced }, ai));
    } catch (error) {
      detail.notes.push(error instanceof Error ? error.message : String(error));
    } finally {
      if (id) { try { lab.end({ id }); } catch { /* already expired */ } }
    }
    detail.at = this.o.now();
    return detail;
  }
}

function failure(error: unknown) {
  if (error instanceof AgentFilesError) return rpcFailure(error.code, error.message);
  return rpcFailure('failed', error instanceof Error ? error.message : String(error));
}

/** agentLab.trace + studio.suites.list / save / run. */
export function registerStudioPreview(studio: StudioServerContext): void {
  const suites = new ScenarioSuites({
    deps: studio.deps, kv: studio.zcc.storage.kv, lab: studio.lab,
    root: () => studio.contexts.current()?.settings.projectRoot ?? '',
    project: () => studio.contexts.current()?.projectId ?? '',
    now: () => studio.deps.now(),
    changed: payload => studio.zcc.realtime.publish(STUDIO_CHANGED_CHANNEL, { projectId: studio.contexts.current()?.projectId, ...payload })
  });
  const guard = async (work: () => Promise<unknown>) => {
    try { return await work(); } catch (error) { return failure(error); }
  };
  studio.registerRpc(STUDIO_RPC.trace, args => guard(async () => ({ ok: true, data: await studio.lab.trace(args) })));
  studio.registerRpc(STUDIO_RPC.suites, args => guard(async () => ({ ok: true, suites: await suites.list(rpcString(args, 'agentPath') || undefined) })));
  studio.registerRpc(STUDIO_RPC.suiteSave, args => guard(async () => {
    const row = labRecord(args);
    return { ok: true, suite: await suites.save({ path: rpcString(args, 'path') || undefined, agentPath: rpcString(args, 'agentPath') || undefined, cases: row.cases, expectedSha256: rpcString(args, 'expectedSha256') || undefined }) };
  }));
  studio.registerRpc(STUDIO_RPC.suiteRun, args => guard(async () => {
    const row = labRecord(args);
    const engine = row.engine === 'rehearsal' ? 'rehearsal' : 'preview';
    const source = typeof row.source === 'string' ? row.source : '';
    if (!source.trim()) throw new AgentFilesError('invalid_input', 'run requires the agent source.');
    const run = await suites.run({
      path: rpcString(args, 'path') || (rpcString(args, 'agentPath') ? suitePathForAgent(rpcString(args, 'agentPath')) : ''),
      source, engine, model: rpcString(args, 'model') || undefined, agentPath: rpcString(args, 'agentPath') || undefined,
      caseIds: Array.isArray(row.caseIds) ? row.caseIds.filter((x): x is string => typeof x === 'string').slice(0, SUITE_LIMITS.cases) : undefined
    });
    return { ok: true, ...run };
  }));
}
