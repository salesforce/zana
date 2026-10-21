import { Fragment, useMemo, useState } from 'react';
import { orgMetricLabel, type OrgCaseResult, type OrgMetricResult, type OrgRunResults, type OrgTestCase } from '../../../lib/org-tests-contract.js';
import {
  ACTIONS_METRIC, RESPONSE_METRIC, TOPIC_METRIC, caseExpectations, caseTopics, filterTestCases, formSummary, metricOf, parseForm,
  qualityMetrics, qualityText, resultsByNumber, type FormFields,
} from './org-cases-model.js';

/** A definition's cases as a table whose rows open in place, next to the open run's result for each case. */
export interface OrgCaseTableProps {
  cases: readonly OrgTestCase[];
  /** The open run of this definition, if any: adds a verdict per case and a "Last run" card. */
  run?: OrgRunResults | null;
}

export const CASE_TABLE_PAGE = 50;

export const ORG_CASE_TABLE_STYLES = `
.sf-oc { display: flex; flex-direction: column; border: 1px solid var(--sf-border); border-radius: 8px; overflow: hidden; }
.sf-oc-tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 8px 10px; border-bottom: 1px solid var(--sf-border); }
.sf-oc-quality { font-size: 11px; color: var(--sf-muted); padding: 6px 10px; border-bottom: 1px solid var(--sf-border); }
.sf-oc-filter { font: inherit; font-size: 11px; color: var(--sf-muted); background: none; border: 1px solid var(--sf-border); border-radius: 999px; padding: 1px 8px; cursor: pointer; white-space: nowrap; }
.sf-oc-filter[aria-pressed="true"] { background: var(--sf-text); border-color: var(--sf-text); color: var(--sf-bg, #fff); }
.sf-oc-scroll { overflow-x: auto; }
.sf-oc table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sf-oc th { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--sf-muted); font-weight: 600; text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--sf-border); white-space: nowrap; }
.sf-oc td { padding: 6px 8px; border-top: 1px solid var(--sf-border); vertical-align: top; }
.sf-oc tr.sf-oc-row { cursor: pointer; }
.sf-oc tr.sf-oc-row:hover td, .sf-oc tr.sf-oc-row.is-open td, .sf-oc tr.sf-oc-detail td { background: var(--sf-soft); }
.sf-oc tr.sf-oc-detail td { border-top: 0; padding: 0 10px 12px 34px; }
.sf-oc-toggle { border: 0; background: none; padding: 0; color: var(--sf-muted); font: inherit; font-size: 9px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.sf-oc-chev { display: inline-block; width: 8px; transition: transform .12s; }
.sf-oc-toggle[aria-expanded="true"] .sf-oc-chev { transform: rotate(90deg); }
.sf-oc-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--sf-border); }
.sf-oc-dot.is-pass { background: var(--sf-success); }
.sf-oc-dot.is-fail, .sf-oc-dot.is-error { background: var(--sf-danger); }
.sf-oc-num { color: var(--sf-muted); text-align: right; width: 24px; }
.sf-oc-utt { max-width: 320px; }
.sf-oc-line { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-oc-hist { display: block; color: var(--sf-muted); font-size: 11px; }
.sf-oc-resp { color: var(--sf-muted); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-oc-tag { display: inline-block; border-radius: 5px; padding: 0 6px; font-size: 11px; line-height: 18px; background: var(--sf-sunken); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: top; }
.sf-oc-tag.is-topic { color: var(--sf-accent); background: var(--sf-soft); }
.sf-oc-tag.is-action { color: #6a3fb5; background: rgba(106, 63, 181, .1); }
.sf-oc-tag.is-form { color: var(--sf-warn, #8a5300); background: rgba(178, 94, 0, .1); }
.sf-oc-tag.is-none { background: none; color: var(--sf-muted); font-style: italic; padding-left: 0; }
.sf-oc-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.sf-oc-muted { color: var(--sf-muted); }
.sf-oc-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 12px; padding-top: 4px; }
.sf-oc-stack { display: grid; gap: 10px; align-content: start; }
.sf-oc-card { background: var(--sf-elevated, var(--sf-bg)); border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px 10px; min-width: 0; }
.sf-oc-card h4 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--sf-muted); }
.sf-oc-bubble { border-radius: 10px; padding: 5px 9px; margin: 4px 0; max-width: 88%; overflow-wrap: anywhere; }
.sf-oc-bubble.is-user { background: var(--sf-soft); margin-left: auto; }
.sf-oc-bubble.is-agent { background: var(--sf-sunken); }
.sf-oc-kv { display: grid; grid-template-columns: minmax(100px, max-content) minmax(0, 1fr); gap: 2px 12px; margin: 4px 0 0; font: 11px ui-monospace, Menlo, monospace; }
.sf-oc-kv dt { color: var(--sf-muted); }
.sf-oc-kv dd { margin: 0; overflow-wrap: anywhere; }
.sf-oc-exp { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 5px 10px; align-items: start; margin: 0; }
.sf-oc-exp dt { color: var(--sf-muted); }
.sf-oc-exp dd { margin: 0; overflow-wrap: anywhere; }
.sf-oc-ok { color: var(--sf-success); }
.sf-oc-bad { color: var(--sf-danger); }
.sf-oc-raw { margin: 6px 0 0; padding: 6px 8px; background: var(--sf-sunken); border-radius: 6px; font: 11px ui-monospace, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.sf-oc-more { padding: 8px 10px; font-size: 12px; color: var(--sf-muted); border-top: 1px dashed var(--sf-border); }
@container (max-width: 720px) { .sf-oc-grid { grid-template-columns: minmax(0, 1fr); } }
`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Tags({ items, kind, empty, max = 2 }: { items: readonly string[] | undefined; kind: 'topic' | 'action'; empty: string; max?: number }) {
  if (items === undefined) return <span className="sf-oc-muted">—</span>;
  if (!items.length) return <span className="sf-oc-tag is-none">{empty}</span>;
  const more = items.length - max;
  return <span className="sf-oc-tags">
    {items.slice(0, max).map((item, i) => <span key={i} className={`sf-oc-tag is-${kind}`} title={item}>{item}</span>)}
    {more > 0 && <span className="sf-oc-muted" title={items.slice(max).join(', ')}>+{more}</span>}
  </span>;
}

function Form({ fields }: { fields: FormFields }) {
  return <dl className="sf-oc-kv">{fields.map(([key, value], i) => <Fragment key={i}><dt>{key}</dt><dd>{value || '—'}</dd></Fragment>)}</dl>;
}

/** ✓ or ✗ for a pass/fail metric, with what was expected when it failed. */
function Mark({ metric, expected }: { metric: OrgMetricResult | undefined; expected?: string }) {
  if (metric?.result === 'pass') return <span className="sf-oc-ok" aria-label="passed"> ✓</span>;
  if (metric?.result === 'fail') return <span className="sf-oc-bad"> ✗{expected ? ` expected ${expected}` : ''}<span className="sf-ot-hidden"> failed</span></span>;
  return null;
}

function LastRun({ result, expectedTopic, expectedActions }: { result: OrgCaseResult; expectedTopic?: string; expectedActions?: string[] }) {
  const topic = metricOf(result, TOPIC_METRIC);
  const actions = metricOf(result, ACTIONS_METRIC);
  const response = metricOf(result, RESPONSE_METRIC);
  const actualTopic = result.topic ?? topic?.actual;
  const quality = result.metrics.filter(m => m.result === null && !m.error);
  const errors = result.metrics.filter(m => m.error);
  return <div className="sf-oc-card" aria-label="Last run">
    <h4>Last run · {result.verdict}</h4>
    <dl className="sf-oc-exp">
      {(topic || actualTopic) && <><dt>Topic</dt><dd>{actualTopic ? <span className="sf-oc-tag is-topic">{actualTopic}</span> : <span className="sf-oc-tag is-none">none</span>}<Mark metric={topic} expected={expectedTopic} /></dd></>}
      {(actions || result.actions.length > 0) && <><dt>Actions</dt><dd><Tags items={result.actions} kind="action" empty="none called" max={4} /><Mark metric={actions} expected={expectedActions?.length ? expectedActions.join(', ') : expectedActions ? 'none' : undefined} /></dd></>}
      {(response || result.reply) && <><dt>Response</dt><dd>
        {response?.result && <span className={response.result === 'pass' ? 'sf-oc-ok' : 'sf-oc-bad'}>{response.result === 'pass' ? '✓' : '✗'}{typeof response.score === 'number' ? ` ${response.score}` : ''} </span>}
        {result.reply ? <span className="sf-oc-muted">“{result.reply}”</span> : <span className="sf-oc-muted">No reply</span>}
      </dd></>}
    </dl>
    {quality.length > 0 && <div className="sf-oc-tags" style={{ marginTop: 8 }}>{quality.map(m => <span key={m.name} className="sf-oc-tag">{qualityText(m)}</span>)}</div>}
    {errors.map(m => <div key={m.name} className="sf-oc-bad">{orgMetricLabel(m.name)}: {m.error}</div>)}
  </div>;
}

function CaseDetail({ testCase, form, result, showRaw, onToggleRaw }: { testCase: OrgTestCase; form: FormFields | null; result?: OrgCaseResult; showRaw: boolean; onToggleRaw(): void }) {
  const expected = caseExpectations(testCase);
  return <div className="sf-oc-grid">
    <div className="sf-oc-card" aria-label="Conversation">
      <h4>Conversation</h4>
      {testCase.conversationHistory.map((turn, i) => {
        const turnForm = turn.role === 'user' ? parseForm(turn.message) : null;
        return <div key={i} className={`sf-oc-bubble ${turn.role === 'user' ? 'is-user' : 'is-agent'}`}>{turnForm ? <span className="sf-oc-tag is-form" title={turn.message}>{formSummary(turnForm)}</span> : turn.message}</div>;
      })}
      <div className="sf-oc-bubble is-user">{form ? <><strong>Form submission</strong><Form fields={form} /></> : testCase.utterance}</div>
      {form && <button type="button" className="sf-ot-textbtn" style={{ fontSize: 11 }} aria-expanded={showRaw} onClick={onToggleRaw}>{showRaw ? 'Hide raw utterance' : 'Show raw utterance'}</button>}
      {form && showRaw && <pre className="sf-oc-raw">{testCase.utterance}</pre>}
    </div>
    <div className="sf-oc-stack">
      <div className="sf-oc-card" aria-label="Expected">
        <h4>Expected</h4>
        <dl className="sf-oc-exp">
          {expected.topic && <><dt>Topic</dt><dd><span className="sf-oc-tag is-topic">{expected.topic}</span></dd></>}
          {expected.actions && <><dt>Actions</dt><dd><Tags items={expected.actions} kind="action" empty="none" max={8} /></dd></>}
          {expected.response && <><dt>Response</dt><dd>{expected.response}</dd></>}
          {expected.other.map(e => <Fragment key={e.name}><dt>{orgMetricLabel(e.name)}</dt><dd>{e.expectedValue}</dd></Fragment>)}
          {!expected.topic && !expected.actions && !expected.response && !expected.other.length && <dd className="sf-oc-muted" style={{ gridColumn: '1 / -1' }}>Only quality metrics are scored.</dd>}
        </dl>
      </div>
      {result && <LastRun result={result} expectedTopic={expected.topic} expectedActions={expected.actions} />}
      {testCase.contextVariables.length > 0 && <div className="sf-oc-card" aria-label="Context variables">
        <h4>Context variables</h4>
        <dl className="sf-oc-kv">{testCase.contextVariables.map((v, i) => <Fragment key={i}><dt>{v.name}</dt><dd>{v.value || '—'}</dd></Fragment>)}</dl>
      </div>}
    </div>
  </div>;
}

export function OrgCaseTable({ cases, run }: OrgCaseTableProps) {
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<string | null>(null);
  const [failedOnly, setFailedOnly] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [raw, setRaw] = useState<ReadonlySet<number>>(new Set());
  const [shown, setShown] = useState(CASE_TABLE_PAGE);
  const results = useMemo(() => resultsByNumber(run?.cases), [run]);
  const hasRun = results.size > 0;
  const topics = useMemo(() => caseTopics(cases), [cases]);
  const quality = useMemo(() => qualityMetrics(cases), [cases]);
  const failed = useMemo(() => cases.filter(c => { const v = results.get(c.number)?.verdict; return v === 'fail' || v === 'error'; }).length, [cases, results]);
  const rows = useMemo(() => filterTestCases(cases, { query, topic, failedOnly: hasRun && failedOnly, results }), [cases, query, topic, failedOnly, hasRun, results]);
  const toggle = (set: ReadonlySet<number>, n: number) => { const next = new Set(set); if (!next.delete(n)) next.add(n); return next; };

  return <div className="sf-oc" data-testid="org-case-table">
    <div className="sf-oc-tools" role="toolbar" aria-label="Case filters">
      <input className="sf-ot-search" type="search" aria-label="Search cases" placeholder="Search utterances, topics, actions…" value={query} onChange={e => setQuery(e.target.value)} />
      {topics.length > 1 && <>
        <button type="button" className="sf-oc-filter" aria-pressed={topic === null} onClick={() => setTopic(null)}>All {cases.length}</button>
        {topics.map(t => <button key={t.topic} type="button" className="sf-oc-filter" aria-pressed={topic === t.topic} onClick={() => setTopic(topic === t.topic ? null : t.topic)}>{t.topic} {t.count}</button>)}
      </>}
      {hasRun && failed > 0 && <><span className="sf-tp-spacer" /><button type="button" className="sf-oc-filter" aria-pressed={failedOnly} onClick={() => setFailedOnly(!failedOnly)}>Failed {failed}</button></>}
    </div>
    {quality.length > 0 && <div className="sf-oc-quality">Scored on every case: {quality.map(orgMetricLabel).join(' · ')}</div>}
    <div className="sf-oc-scroll">
      <table aria-label="Test cases">
        <thead><tr><th><span className="sf-ot-hidden">Open</span></th><th>#</th><th>Utterance</th><th>Topic</th><th>Actions</th><th>Expected response</th><th>Context</th></tr></thead>
        <tbody>
          {rows.slice(0, shown).map(testCase => {
            const n = testCase.number;
            const isOpen = open.has(n);
            const form = parseForm(testCase.utterance);
            const expected = caseExpectations(testCase);
            const result = results.get(n);
            const turns = testCase.conversationHistory.length;
            return <Fragment key={n}>
              <tr className={`sf-oc-row${isOpen ? ' is-open' : ''}`} onClick={() => setOpen(toggle(open, n))}>
                <td><button type="button" className="sf-oc-toggle" aria-expanded={isOpen} aria-label={`Case ${n}${result ? ` · ${result.verdict}` : ''}`}>
                  <span className="sf-oc-chev" aria-hidden="true">▶</span>{hasRun && <i className={`sf-oc-dot${result ? ` is-${result.verdict}` : ''}`} aria-hidden="true" />}
                </button></td>
                <td className="sf-oc-num">{n}</td>
                <td className="sf-oc-utt">
                  <span className="sf-oc-line" title={testCase.utterance}>{form ? <span className="sf-oc-tag is-form">{formSummary(form)}</span> : testCase.utterance}</span>
                  {turns > 0 && <span className="sf-oc-hist">after {plural(turns, 'earlier turn')}</span>}
                </td>
                <td>{expected.topic ? <span className="sf-oc-tag is-topic" title={expected.topic}>{expected.topic}</span> : <span className="sf-oc-muted">—</span>}</td>
                <td><Tags items={expected.actions} kind="action" empty="none" /></td>
                <td className="sf-oc-resp" title={expected.response}>{expected.response ?? <span className="sf-oc-muted">—</span>}</td>
                <td className="sf-oc-muted" title={testCase.contextVariables.map(v => v.name).join(', ')}>{testCase.contextVariables.length ? plural(testCase.contextVariables.length, 'var') : '—'}</td>
              </tr>
              {isOpen && <tr className="sf-oc-detail"><td colSpan={7}>
                <CaseDetail testCase={testCase} form={form} result={result} showRaw={raw.has(n)} onToggleRaw={() => setRaw(toggle(raw, n))} />
              </td></tr>}
            </Fragment>;
          })}
        </tbody>
      </table>
    </div>
    {!rows.length && <div className="sf-oc-more">No case matches.</div>}
    {rows.length > shown && <div className="sf-oc-more">Showing {shown} of {rows.length} cases. <button type="button" className="sf-ot-textbtn" onClick={() => setShown(shown + CASE_TABLE_PAGE)}>Show more</button></div>}
  </div>;
}
