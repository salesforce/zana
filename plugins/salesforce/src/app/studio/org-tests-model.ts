import {
  orgMetricLabel,
  type OrgCaseResult, type OrgRunCounts, type OrgRunRecord, type OrgRunResults, type OrgTestCase, type OrgTestDefinitionSummary
} from '../../../lib/org-tests-contract.js';

/** Pure helpers behind the Org tests view: filtering, paging, diffs, export. */

export const CASE_PAGE_SIZE = 25;

/** `.../aiAuthoringBundles/<Name>/<Name>.agent` -> `<Name>`; null for any other path. */
export function agentNameFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const bundle = /aiAuthoringBundles\/([^/]+)\//.exec(path.replace(/\\/g, '/'));
  if (bundle) return bundle[1];
  const file = /([^/\\]+)\.agent$/.exec(path);
  return file ? file[1] : null;
}

export interface DefinitionFilter { query?: string; agent?: string | null }

/** Subject names carry no version; match case-insensitively. */
export function filterDefinitions(defs: readonly OrgTestDefinitionSummary[], filter: DefinitionFilter): OrgTestDefinitionSummary[] {
  const query = (filter.query ?? '').trim().toLowerCase();
  const agent = filter.agent?.trim().toLowerCase();
  return defs.filter(def => {
    if (agent && (def.subjectName ?? '').toLowerCase() !== agent) return false;
    if (!query) return true;
    return [def.name, def.label, def.subjectName].some(text => (text ?? '').toLowerCase().includes(query));
  });
}

export const sameAgent = (def: Pick<OrgTestDefinitionSummary, 'subjectName'>, agent: string | null | undefined) =>
  Boolean(agent && def.subjectName && def.subjectName.toLowerCase() === agent.toLowerCase());

export interface DefinitionGroup {
  /** The lowercased agent name, or `loading` / `unknown` for definitions whose agent is not known (yet). */
  key: string;
  label: string;
  state: 'agent' | 'loading' | 'unknown';
  defs: OrgTestDefinitionSummary[];
}

/**
 * Definitions by the agent they test: the pinned agent first, then the largest groups, then by name. Definitions whose
 * agent is still being read come next, and those it could not be read for last.
 */
export function groupDefinitions(defs: readonly OrgTestDefinitionSummary[], pending: ReadonlySet<string>, pinned?: string | null): DefinitionGroup[] {
  const agents = new Map<string, DefinitionGroup>();
  const loading: DefinitionGroup = { key: 'loading', label: 'Reading agent…', state: 'loading', defs: [] };
  const unknown: DefinitionGroup = { key: 'unknown', label: 'Agent unknown', state: 'unknown', defs: [] };
  for (const def of defs) {
    if (!def.subjectName) { (pending.has(def.name) ? loading : unknown).defs.push(def); continue; }
    const key = def.subjectName.toLowerCase();
    const group = agents.get(key) ?? { key, label: def.subjectName, state: 'agent' as const, defs: [] };
    group.defs.push(def);
    agents.set(key, group);
  }
  const first = pinned?.toLowerCase();
  const sorted = [...agents.values()].sort((a, b) => Number(b.key === first) - Number(a.key === first) || b.defs.length - a.defs.length || a.label.localeCompare(b.label));
  return [...sorted, loading, unknown].filter(group => group.defs.length > 0);
}

/** 0..1, or null when nothing was graded. Errors count against the rate; pending cases do not count. */
export function passRate(counts: OrgRunCounts | undefined): number | null {
  if (!counts) return null;
  const graded = counts.pass + counts.fail + counts.error;
  return graded > 0 ? counts.pass / graded : null;
}
export const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

/** Pass rates of the finished runs, oldest first, at most `limit`. `runs` is newest first. */
export function sparkSeries(runs: readonly OrgRunRecord[], limit = 12): number[] {
  const rates: number[] = [];
  for (const run of runs) {
    const rate = run.status === 'completed' ? passRate(run.counts) : null;
    if (rate !== null) rates.push(rate);
    if (rates.length >= limit) break;
  }
  return rates.reverse();
}

export type CaseFilter = 'all' | 'failing' | 'passing' | 'errors' | 'changed';
export type CaseSort = 'number' | 'verdict' | 'latency' | 'score';

const VERDICT_ORDER = { fail: 0, error: 1, pending: 2, pass: 3 } as const;
export const caseKey = (row: Pick<OrgCaseResult, 'number'>) => row.number;

/** Cases whose verdict differs from the same case in the previous run (or that are new). */
export function changedCases(run: OrgRunResults, previous?: OrgRunResults | null): OrgCaseResult[] {
  if (!previous) return [];
  const before = new Map(previous.cases.map(row => [row.number, row.verdict]));
  return run.cases.filter(row => before.get(row.number) !== row.verdict);
}

export function filterCases(run: OrgRunResults, filter: CaseFilter, previous?: OrgRunResults | null): OrgCaseResult[] {
  switch (filter) {
    case 'failing': return run.cases.filter(row => row.verdict === 'fail');
    case 'passing': return run.cases.filter(row => row.verdict === 'pass');
    case 'errors': return run.cases.filter(row => row.verdict === 'error');
    case 'changed': return changedCases(run, previous);
    default: return [...run.cases];
  }
}

export function searchCases(rows: readonly OrgCaseResult[], query: string): OrgCaseResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter(row => [row.utterance, row.topic, row.reply, ...row.actions, ...row.metrics.map(m => `${m.name} ${m.expected ?? ''} ${m.actual ?? ''}`)]
    .some(text => (text ?? '').toLowerCase().includes(needle)));
}

const latencyOf = (row: OrgCaseResult): number => {
  const metric = row.metrics.find(m => m.name === 'output_latency_milliseconds');
  const value = Number(metric?.actual ?? metric?.score);
  return Number.isFinite(value) ? value : -1;
};
const scoreOf = (row: OrgCaseResult): number => {
  const scores = row.metrics.filter(m => m.name !== 'output_latency_milliseconds').map(m => m.score).filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : -1;
};

/** number: ascending; verdict: failures first; latency and score: highest first. Stable. */
export function sortCases(rows: readonly OrgCaseResult[], sort: CaseSort): OrgCaseResult[] {
  const key = (row: OrgCaseResult): number => sort === 'verdict' ? VERDICT_ORDER[row.verdict] : sort === 'latency' ? -latencyOf(row) : sort === 'score' ? -scoreOf(row) : row.number;
  return rows.map((row, index) => ({ row, index })).sort((a, b) => key(a.row) - key(b.row) || a.row.number - b.row.number || a.index - b.index).map(x => x.row);
}

export function pageOf<T>(rows: readonly T[], page: number, size = CASE_PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
  return { rows: rows.slice(current * size, (current + 1) * size), page: current, pages };
}

export interface MetricRate { name: string; label: string; pass: number; fail: number; rate: number | null; average: number | null }

/** Per-metric pass rates over graded results; scored-only metrics report an average instead. */
export function metricRates(cases: readonly OrgCaseResult[]): MetricRate[] {
  const table = new Map<string, { pass: number; fail: number; sum: number; scored: number }>();
  for (const row of cases) for (const metric of row.metrics) {
    const entry = table.get(metric.name) ?? { pass: 0, fail: 0, sum: 0, scored: 0 };
    if (metric.result === 'pass') entry.pass++;
    else if (metric.result === 'fail') entry.fail++;
    if (typeof metric.score === 'number' && Number.isFinite(metric.score)) { entry.sum += metric.score; entry.scored++; }
    table.set(metric.name, entry);
  }
  return [...table].map(([name, e]) => ({
    name, label: orgMetricLabel(name), pass: e.pass, fail: e.fail,
    rate: e.pass + e.fail > 0 ? e.pass / (e.pass + e.fail) : null,
    average: e.scored ? e.sum / e.scored : null
  }));
}

export interface RunDiff { newlyFailing: OrgCaseResult[]; fixed: OrgCaseResult[] }
const bad = (row: OrgCaseResult) => row.verdict === 'fail' || row.verdict === 'error';

export function diffRuns(run: OrgRunResults, previous?: OrgRunResults | null): RunDiff {
  if (!previous) return { newlyFailing: [], fixed: [] };
  const before = new Map(previous.cases.map(row => [row.number, row]));
  const newlyFailing: OrgCaseResult[] = [];
  const fixed: OrgCaseResult[] = [];
  for (const row of run.cases) {
    const old = before.get(row.number);
    if (!old) continue;
    if (bad(row) && old.verdict === 'pass') newlyFailing.push(row);
    if (row.verdict === 'pass' && bad(old)) fixed.push(row);
  }
  return { newlyFailing, fixed };
}

const csvCell = (value: unknown): string => {
  let text = value === undefined || value === null ? '' : String(value);
  // Spreadsheet formula injection: prefix text cells that would be read as a formula. Numbers are data.
  if (typeof value !== 'number' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** One row per case and metric (a case with no metrics gets one row). */
export function casesToCsv(run: Pick<OrgRunResults, 'runId' | 'definition'>, cases: readonly OrgCaseResult[]): string {
  const header = ['run', 'definition', 'case', 'verdict', 'utterance', 'topic', 'actions', 'reply', 'metric', 'expected', 'actual', 'score', 'result', 'explanation'];
  const lines = [header.join(',')];
  for (const row of cases) {
    const base = [run.runId, run.definition, row.number, row.verdict, row.utterance, row.topic, row.actions.join(' | '), row.reply];
    const metrics = row.metrics.length ? row.metrics : [null];
    for (const m of metrics) {
      lines.push([...base, m?.name, m?.expected, m?.actual, m?.score, m?.result, m?.explanation ?? m?.error].map(csvCell).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

export function relativeTime(at: number | undefined, now = Date.now()): string {
  if (!at || !Number.isFinite(at)) return '—';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function formatDuration(run: Pick<OrgRunRecord, 'startedAt' | 'endedAt'>, now = Date.now()): string {
  const ms = Math.max(0, (run.endedAt ?? now) - run.startedAt);
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Cases to import from a run: the definition's own cases (with expectations) for the numbers
 * given, falling back to the run's utterance alone when the definition is not loaded.
 */
export function casesForImport(rows: readonly OrgCaseResult[], definitionCases: readonly OrgTestCase[] | undefined): OrgTestCase[] {
  const byNumber = new Map((definitionCases ?? []).map(c => [c.number, c]));
  return rows.map(row => byNumber.get(row.number) ?? { number: row.number, utterance: row.utterance, conversationHistory: [], contextVariables: [], expectations: [] });
}

/** A compact prompt asking the thread agent to fix the failing cases. */
export function fixPrompt(run: Pick<OrgRunResults, 'runId' | 'definition' | 'subjectName'>, failing: readonly OrgCaseResult[], path: string | null, max = 10): string {
  const clip = (text: string | undefined, n = 200) => (text && text.length > n ? `${text.slice(0, n)}…` : text ?? '');
  const lines = failing.slice(0, max).map(row => {
    const bits = row.metrics.filter(m => m.result === 'fail' || m.error).map(m => `${orgMetricLabel(m.name)}: expected ${clip(m.expected) || '—'}, got ${clip(m.actual ?? m.error) || '—'}`);
    return `- #${row.number} "${clip(row.utterance, 140)}" -> ${bits.join('; ') || row.verdict}`;
  });
  return [
    `These org tests fail for ${path ?? row0(run)} (run ${run.runId}, definition ${run.definition}): ${failing.length} case${failing.length === 1 ? '' : 's'}.`,
    ...lines,
    ...(failing.length > max ? [`(+${failing.length - max} more)`] : []),
    'Work out why the agent behaves this way and propose changes with ui.command editor.proposeEdit. Do not save, publish or activate anything.'
  ].join('\n');
}
const row0 = (run: Pick<OrgRunResults, 'subjectName' | 'definition'>) => run.subjectName ?? run.definition;
