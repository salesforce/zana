import { orgMetricLabel, type OrgCaseResult, type OrgMetricResult, type OrgTestCase } from '../../../lib/org-tests-contract.js';

/** Pure helpers behind the org test case table: forms, expectations, topic filters and the matching run case. */

export const TOPIC_METRIC = 'topic_sequence_match';
export const ACTIONS_METRIC = 'action_sequence_match';
export const RESPONSE_METRIC = 'bot_response_rating';
export const LATENCY = 'output_latency_milliseconds';

/** A form submission's fields as [key, text] pairs. */
export type FormFields = Array<[string, string]>;

const asObject = (text: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
};

/**
 * The fields of an utterance that is a JSON form submission, or null for plain text. Testing Center exports often keep
 * the CSV-doubled quotes (`{""contactId"": ""003…""}`), so those are undone when the text is not JSON as written.
 */
export function parseForm(utterance: string): FormFields | null {
  const text = utterance.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  const object = asObject(text) ?? asObject(text.replace(/""/g, '"'));
  if (!object) return null;
  return Object.entries(object).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)]);
}

/** The chip text for a form: its first two keys and how many more. */
export function formSummary(fields: FormFields): string {
  const keys = fields.map(([key]) => key);
  if (!keys.length) return '{ } Form';
  const more = keys.length - 2;
  return `{ } Form · ${keys.slice(0, 2).join(', ')}${more > 0 ? ` +${more}` : ''}`;
}

/** An action list as written in an expectation: `['A', 'B']`, `["A"]`, `[]` or a bare name. */
export function parseList(value: string | undefined): string[] {
  const text = (value ?? '').trim();
  if (!text) return [];
  const inner = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  return inner.split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '').trim()).filter(Boolean);
}

export interface CaseExpectations {
  topic?: string;
  /** Undefined when the case does not check actions; empty when it expects none. */
  actions?: string[];
  response?: string;
  /** Other expectations with an expected value. */
  other: Array<{ name: string; expectedValue: string }>;
}

/** What a case checks; quality metrics with no expected value are left to {@link qualityMetrics}. */
export function caseExpectations(testCase: Pick<OrgTestCase, 'expectations'>): CaseExpectations {
  const out: CaseExpectations = { other: [] };
  for (const { name, expectedValue } of testCase.expectations) {
    if (expectedValue === undefined) continue;
    if (name === TOPIC_METRIC) out.topic = expectedValue.trim() || undefined;
    else if (name === ACTIONS_METRIC) out.actions = parseList(expectedValue);
    else if (name === RESPONSE_METRIC) out.response = expectedValue;
    else out.other.push({ name, expectedValue });
  }
  return out;
}

/** The metrics scored with no expected value, in first-seen order: shown once for the whole definition. */
export function qualityMetrics(cases: readonly Pick<OrgTestCase, 'expectations'>[]): string[] {
  const names = new Set<string>();
  for (const testCase of cases) for (const e of testCase.expectations) if (e.expectedValue === undefined) names.add(e.name);
  return [...names];
}

/** The expected topics with their case counts, most cases first, then by name. */
export function caseTopics(cases: readonly Pick<OrgTestCase, 'expectations'>[]): Array<{ topic: string; count: number }> {
  const counts = new Map<string, number>();
  for (const testCase of cases) {
    const topic = caseExpectations(testCase).topic;
    if (topic) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

export interface CaseFilterInput { query?: string; topic?: string | null; failedOnly?: boolean; results?: ReadonlyMap<number, OrgCaseResult> }

/** Cases matching a search over utterance, form, history, expectations and context, a topic and, with a run, failures only. */
export function filterTestCases(cases: readonly OrgTestCase[], filter: CaseFilterInput): OrgTestCase[] {
  const needle = filter.query?.trim().toLowerCase() ?? '';
  return cases.filter(testCase => {
    const expected = caseExpectations(testCase);
    if (filter.topic && expected.topic !== filter.topic) return false;
    if (filter.failedOnly) {
      const verdict = filter.results?.get(testCase.number)?.verdict;
      if (verdict !== 'fail' && verdict !== 'error') return false;
    }
    if (!needle) return true;
    return [
      testCase.utterance, expected.topic, expected.response, ...(expected.actions ?? []),
      ...testCase.conversationHistory.map(turn => turn.message),
      ...testCase.contextVariables.flatMap(v => [v.name, v.value]),
    ].some(text => (text ?? '').toLowerCase().includes(needle));
  });
}

/** The open run's cases by number, so a definition case finds what happened to it. */
export const resultsByNumber = (cases: readonly OrgCaseResult[] | undefined) => new Map((cases ?? []).map(row => [row.number, row]));

export const metricOf = (row: OrgCaseResult | undefined, name: string): OrgMetricResult | undefined => row?.metrics.find(m => m.name === name);

/** A quality score as shown: latency in seconds, a score as is. */
export function qualityText(metric: OrgMetricResult): string {
  const label = orgMetricLabel(metric.name);
  if (metric.name === LATENCY) {
    const ms = Number(metric.actual ?? metric.score);
    return Number.isFinite(ms) ? `${label} ${(ms / 1000).toFixed(1)} s` : `${label} —`;
  }
  return `${label} ${typeof metric.score === 'number' ? metric.score : '—'}`;
}
