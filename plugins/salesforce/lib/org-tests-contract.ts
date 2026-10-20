/**
 * Org tests: the org's AiEvaluationDefinitions (Testing Center) and their runs.
 * Isomorphic: imported by the server (lib/org-tests.ts) and the Studio (src/app/studio/*). No node imports.
 *
 * The org cannot list runs (GET /einstein/ai-evaluations/runs is not allowed), so run
 * history is what this plugin started or attached, kept per project and bounded.
 */

export const ORG_TESTS_RPC = {
  /** {refresh?} -> {ok, org, definitions: OrgTestDefinitionSummary[], at} */
  list: 'studio.orgTests.list',
  /** {name} -> {ok, definition: OrgTestDefinition} */
  definition: 'studio.orgTests.definition',
  /**
   * {names: string[] (1..detailsBatch), refresh?} -> {ok, definitions: OrgTestDefinitionSummary[], missing: string[]}.
   * One metadata retrieve for the batch: the agent (subjectName), label and case count of each definition. The org fails
   * a retrieve of about a hundred definitions at once, so callers page through the list in batches.
   */
  details: 'studio.orgTests.details',
  /**
   * {name, threadId?, via?} -> {ok, run: OrgRunRecord}. startedBy is 'studio' when via === 'studio', else 'thread' when a
   * threadId is present, else 'studio'. On a production or unknown org the start confirms as org.write (a read grant never covers it).
   */
  start: 'studio.orgTests.run.start',
  /** {runId} -> {ok, run: OrgRunResults}. Refreshes from the org while the run is not terminal. */
  run: 'studio.orgTests.run.get',
  /** {runId} -> {ok, run: OrgRunRecord} */
  cancel: 'studio.orgTests.run.cancel',
  /** {name?} -> {ok, runs: OrgRunRecord[]} newest first */
  runs: 'studio.orgTests.runs',
  /** {runId, name?} -> {ok, run: OrgRunResults}. Adds a run started elsewhere (Testing Center, CI) to the history. */
  attach: 'studio.orgTests.run.attach',
} as const;

export const ORG_TESTS_LIMITS = {
  /** Runs kept per project. */
  storedRuns: 60,
  /** Definition XML read per file. */
  definitionBytes: 4_000_000,
  /** Definitions read per orgTests.details call (one retrieve). */
  detailsBatch: 25,
  /** Test cases returned per definition. */
  cases: 1_000,
  /** Characters kept per text field (utterance, expected/actual values, explanations). */
  text: 4_000,
  /** Cases a local scenario suite holds (SUITE_LIMITS.cases). */
  suiteCases: 50,
  /** Characters kept per metric text field (expected, actual, explanation, error). */
  metricText: 1_000,
  /** Metrics kept per case. */
  metrics: 20,
  /** JSON bytes stored per finished run's results; text is trimmed beyond it. */
  resultBytes: 1_500_000,
} as const;

/** The realtime kind on STUDIO_CHANGED_CHANNEL when org-test runs change: {projectId, kind: 'orgTests', runId}. */
export const ORG_TESTS_CHANGED_KIND = 'orgTests';

export interface OrgTestDefinitionSummary {
  /** Metadata fullName, the name runs are started with. */
  name: string;
  /** The `<name>` label inside the definition, when the index has read it. */
  label?: string;
  subjectName?: string;
  subjectType?: string;
  subjectVersion?: string;
  caseCount?: number;
  createdBy?: string;
  lastModified?: string;
}

export interface OrgTestExpectation {
  /** topic_sequence_match, action_sequence_match, bot_response_rating, completeness, coherence, conciseness, output_latency_milliseconds, ... */
  name: string;
  expectedValue?: string;
}

export interface OrgTestCase {
  number: number;
  utterance: string;
  /** Earlier turns, oldest first. */
  conversationHistory: Array<{ role: 'user' | 'agent'; message: string }>;
  contextVariables: Array<{ name: string; value: string }>;
  expectations: OrgTestExpectation[];
}

export interface OrgTestDefinition extends OrgTestDefinitionSummary {
  label: string;
  testCases: OrgTestCase[];
  /** True when the definition had more than ORG_TESTS_LIMITS.cases cases. */
  truncated?: boolean;
}

export type OrgRunStatus = 'new' | 'in_progress' | 'completed' | 'error' | 'terminated';
export type OrgCaseVerdict = 'pass' | 'fail' | 'error' | 'pending';

export interface OrgMetricResult {
  name: string;
  expected?: string;
  actual?: string;
  score?: number;
  /** null for scored-only metrics (completeness, coherence, latency, ...). */
  result: 'pass' | 'fail' | null;
  explanation?: string;
  status?: OrgRunStatus;
  error?: string;
}

export interface OrgCaseResult {
  number: number;
  utterance: string;
  status: OrgRunStatus;
  topic?: string;
  actions: string[];
  /** The agent's reply. */
  reply?: string;
  sessionId?: string;
  startTime?: string;
  endTime?: string;
  metrics: OrgMetricResult[];
  verdict: OrgCaseVerdict;
}

export interface OrgRunCounts { total: number; pass: number; fail: number; error: number; pending: number }

export interface OrgRunRecord {
  runId: string;
  definition: string;
  subjectName?: string;
  orgId: string;
  orgAlias: string;
  status: OrgRunStatus;
  startedAt: number;
  /** When this plugin added the run to the history; history order and retention use it (startedAt for older records). */
  addedAt?: number;
  endedAt?: number;
  /** studio: a click in the Studio; thread: an agent's sf_workbench call; attached: started elsewhere and added by id. */
  startedBy: 'studio' | 'thread' | 'attached';
  threadId?: string;
  counts?: OrgRunCounts;
  errorMessage?: string;
}

export interface OrgRunResults extends OrgRunRecord { cases: OrgCaseResult[] }

const TERMINAL: ReadonlySet<OrgRunStatus> = new Set(['completed', 'error', 'terminated']);
export const isOrgRunTerminal = (status: OrgRunStatus) => TERMINAL.has(status);

/** NEW / IN_PROGRESS / COMPLETED / ERROR / TERMINATED (any case; "Cancelled" maps to terminated). */
export function orgRunStatus(value: unknown): OrgRunStatus {
  return parseOrgRunStatus(value) ?? 'new';
}

/** Like orgRunStatus, but null for a missing or unrecognised value. */
export function parseOrgRunStatus(value: unknown): OrgRunStatus | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  if (text === 'new' || text === 'pending' || text === 'queued') return 'new';
  if (text === 'in_progress' || text === 'running') return 'in_progress';
  if (text === 'completed' || text === 'complete' || text === 'succeeded' || text === 'success') return 'completed';
  if (text === 'terminated' || text === 'cancelled' || text === 'canceled') return 'terminated';
  if (text === 'error' || text === 'failed') return 'error';
  return null;
}

/** A case fails when any graded metric fails; errors and unfinished cases are reported as such. */
export function caseVerdict(row: Pick<OrgCaseResult, 'status' | 'metrics'>): OrgCaseVerdict {
  if (row.status === 'error' || row.metrics.some(m => m.status === 'error' || Boolean(m.error))) return 'error';
  if (row.metrics.some(m => m.result === 'fail')) return 'fail';
  if (row.status !== 'completed') return 'pending';
  return 'pass';
}

export function runCounts(cases: ReadonlyArray<Pick<OrgCaseResult, 'verdict'>>, total = cases.length): OrgRunCounts {
  const counts: OrgRunCounts = { total: Math.max(total, cases.length), pass: 0, fail: 0, error: 0, pending: 0 };
  for (const row of cases) counts[row.verdict]++;
  counts.pending += counts.total - cases.length;
  return counts;
}

/** Readable labels for the metric names Testing Center uses. */
export const ORG_METRIC_LABEL: Record<string, string> = {
  topic_sequence_match: 'Topic',
  action_sequence_match: 'Actions',
  bot_response_rating: 'Response',
  completeness: 'Completeness',
  coherence: 'Coherence',
  conciseness: 'Conciseness',
  output_latency_milliseconds: 'Latency',
  instruction_following: 'Instruction following',
  factuality: 'Factuality',
};
export const orgMetricLabel = (name: string) => ORG_METRIC_LABEL[name] ?? name.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

/**
 * The JSON the scenario-suite importer (studio.suites.import) reads: inputs.utterance,
 * conversationHistory and expectation rows. Quality metrics without an expected value are dropped.
 */
export function definitionImportText(definition: Pick<OrgTestDefinition, 'name' | 'label'>, cases: readonly OrgTestCase[]): string {
  return JSON.stringify({
    name: definition.label || definition.name,
    testCases: cases.map(c => ({
      id: `${definition.name}-${c.number}`.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').slice(0, 80),
      name: `${definition.label || definition.name} #${c.number}`.slice(0, 200),
      inputs: { utterance: c.utterance },
      conversationHistory: c.conversationHistory.map(turn => ({ role: turn.role, message: turn.message })),
      expectation: c.expectations.filter(e => e.expectedValue !== undefined && e.expectedValue !== '' && e.expectedValue !== '[]')
        .map(e => ({ name: e.name, expectedValue: e.expectedValue })),
    })),
  });
}
