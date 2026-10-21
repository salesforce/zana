import { Fragment, useMemo, useState } from 'react';
import { orgMetricLabel, type OrgCaseResult, type OrgRunResults, type OrgTestCase } from '../../../lib/org-tests-contract.js';
import {
  casesForImport, casesToCsv, diffRuns, filterCases, fixPrompt, formatDuration, metricRates, pageOf, passRate, percent, searchCases, sortCases,
  type CaseFilter, type CaseSort
} from './org-tests-model.js';

/** One org test run: header, per-metric pass rates, and the filterable case table. */
export interface OrgRunDetailProps {
  run: OrgRunResults;
  /** The run before this one for the same definition, for Changed and the diff line. */
  previous?: OrgRunResults | null;
  /** The definition's cases, so an import keeps expectations. */
  definitionCases?: readonly OrgTestCase[];
  path: string | null;
  busy?: boolean;
  onImport(cases: OrgTestCase[]): void;
  onAskAgent?(prompt: string): void;
}

const TABS: Array<{ id: CaseFilter; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'failing', label: 'Failing' }, { id: 'passing', label: 'Passing' }, { id: 'errors', label: 'Errors' }, { id: 'changed', label: 'Changed' }
];
const VERDICT_LABEL = { pass: '✓ Pass', fail: '✗ Fail', error: '! Error', pending: '… Pending' } as const;

/** Human label for a run: its start time, falling back to the id; the full id stays in the title. */
export function runLabel(run: { runId: string; startedAt?: number }): string {
  if (!run.startedAt || !Number.isFinite(run.startedAt)) return `Run ${run.runId}`;
  return `Run · ${new Date(run.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

/** Browser download of a text file; a no-op where object URLs are missing (jsdom). */
export function downloadText(name: string, text: string, type = 'text/csv'): boolean {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof document === 'undefined') return false;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

export function OrgRunDetail({ run, previous, definitionCases, path, busy, onImport, onAskAgent }: OrgRunDetailProps) {
  const [filter, setFilter] = useState<CaseFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CaseSort>('number');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const counts = run.counts;
  const metrics = useMemo(() => metricRates(run.cases), [run.cases]);
  const diff = useMemo(() => diffRuns(run, previous), [run, previous]);
  const tabCount = useMemo(() => Object.fromEntries(TABS.map(t => [t.id, filterCases(run, t.id, previous).length])) as Record<CaseFilter, number>, [run, previous]);
  const rows = useMemo(() => sortCases(searchCases(filterCases(run, filter, previous), query), sort), [run, filter, previous, query, sort]);
  const paged = pageOf(rows, page);
  const failing = useMemo(() => run.cases.filter(row => row.verdict === 'fail' || row.verdict === 'error'), [run.cases]);

  const exportCsv = () => {
    const ok = downloadText(`${run.definition}-${run.runId}.csv`, casesToCsv(run, rows));
    setExported(ok ? `Exported ${rows.length} case${rows.length === 1 ? '' : 's'}.` : 'Downloads are not available here.');
  };
  const change = <T,>(set: (v: T) => void) => (value: T) => { set(value); setPage(0); };

  return (
    <div className="sf-ot-run" data-testid="org-run-detail">
      <div className="sf-tp-head">
        <strong title={`Run ${run.runId}`}>{runLabel(run)}</strong>
        <span className={`sf-tp-chip is-status-${run.status}`}>{run.status.replace('_', ' ')}</span>
        {counts && <span className="sf-tp-sub" data-testid="org-run-counts">
          {counts.pass} pass · {counts.fail} fail · {counts.error} error{counts.pending ? ` · ${counts.pending} pending` : ''} of {counts.total} · {percent(passRate(counts))}
        </span>}
        <span className="sf-tp-sub">{formatDuration(run)}</span>
        {run.errorMessage && <span className="sf-tp-sub" role="alert">{run.errorMessage}</span>}
      </div>

      {metrics.length > 0 && <ul className="sf-ot-metrics" aria-label="Pass rate by metric">
        {metrics.map(m => <li key={m.name}>
          <span>{m.label}</span>
          {m.rate !== null
            ? <><span className="sf-ot-bar" role="img" aria-label={`${m.label} ${percent(m.rate)}`}><span style={{ width: `${Math.round(m.rate * 100)}%` }} /></span><span>{percent(m.rate)} ({m.pass}/{m.pass + m.fail})</span></>
            : <span className="sf-tp-sub">avg {m.average === null ? '—' : m.average.toFixed(2)}</span>}
        </li>)}
      </ul>}

      {previous && <p className="sf-tp-foot" data-testid="org-run-diff">
        Against {runLabel(previous)}: {diff.newlyFailing.length} newly failing, {diff.fixed.length} fixed.
      </p>}

      <div className="sf-tp-bar sf-ot-toolbar">
        <div className="sf-ot-tabs" role="tablist" aria-label="Case filter">
        {TABS.map(t => <button key={t.id} type="button" role="tab" id={`org-tab-${t.id}`} aria-selected={filter === t.id}
          className={`sf-tp-btn${filter === t.id ? ' is-primary' : ''}`} disabled={t.id === 'changed' && !previous} onClick={() => change(setFilter)(t.id)}>
          {t.label} {tabCount[t.id]}
        </button>)}
        </div>
        <input className="sf-ot-search" type="search" aria-label="Search cases" value={query} onChange={e => change(setQuery)(e.target.value)} placeholder="Search utterance, topic, reply…" />
        <select className="sf-ot-select" aria-label="Sort by" value={sort} onChange={e => change(setSort)(e.target.value as CaseSort)}>
          <option value="number">Sort: Case number</option><option value="verdict">Sort: Failures first</option><option value="latency">Sort: Latency</option><option value="score">Sort: Score</option>
        </select>
        <span className="sf-tp-spacer" />
        <button type="button" className="sf-tp-btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
        <button type="button" className="sf-tp-btn is-primary" disabled={busy || !failing.length || !path}
          title={!path ? 'Open an agent file to import into its suite.' : undefined}
          onClick={() => onImport(casesForImport(failing, definitionCases))}>Import failing to suite</button>
        {onAskAgent && <button type="button" className="sf-tp-btn is-primary" disabled={!failing.length}
          onClick={() => onAskAgent(fixPrompt(run, failing, path))}>Fix with agent</button>}
      </div>
      {exported && <div className="sf-tp-sub" role="status">{exported}</div>}

      {!rows.length ? <div className="sf-tp-empty">{run.cases.length ? 'No cases match.' : 'No case results yet.'}</div> :
        <table className="sf-tp-table" data-testid="org-run-table">
          <thead><tr><th>#</th><th>Utterance</th><th>Topic</th><th>Verdict</th><th><span className="sf-ot-hidden">Actions</span></th></tr></thead>
          <tbody>{paged.rows.map(row => <Fragment key={row.number}>
            <tr className="sf-tp-row" data-testid={`org-case-${row.number}`}>
              <td>{row.number}</td>
              <td><button type="button" className="sf-ot-link" aria-expanded={open === row.number} onClick={() => setOpen(open === row.number ? null : row.number)}>{row.utterance || '(empty)'}</button></td>
              <td className="sf-tp-sub">{row.topic ?? '—'}</td>
              <td><span className={`sf-tp-chip is-${row.verdict === 'pass' ? 'pass' : row.verdict === 'pending' ? 'pending' : 'fail'}`}>{VERDICT_LABEL[row.verdict]}</span></td>
              <td><button type="button" className="sf-tp-btn" disabled={busy || !path} aria-label={`Add case ${row.number} to suite`}
                onClick={() => onImport(casesForImport([row], definitionCases))}>Add to suite</button></td>
            </tr>
            {open === row.number && <tr className="sf-tp-detail"><td colSpan={5}><CaseDetail row={row} /></td></tr>}
          </Fragment>)}</tbody>
        </table>}
      {paged.pages > 1 && <div className="sf-tp-bar" aria-label="Pages">
        <button type="button" className="sf-tp-btn" disabled={paged.page === 0} onClick={() => setPage(paged.page - 1)}>Previous</button>
        <span className="sf-tp-sub">Page {paged.page + 1} of {paged.pages}</span>
        <button type="button" className="sf-tp-btn" disabled={paged.page >= paged.pages - 1} onClick={() => setPage(paged.page + 1)}>Next</button>
      </div>}
    </div>
  );
}

function CaseDetail({ row }: { row: OrgCaseResult }) {
  return (
    <div className="sf-ot-case">
      <p className="sf-tp-turn"><strong>Utterance</strong> {row.utterance}</p>
      <p className="sf-tp-sub">Topic {row.topic ?? '—'} · Actions {row.actions.length ? row.actions.join(', ') : 'none'}</p>
      {row.reply && <p className="sf-tp-turn"><strong>Reply</strong> {row.reply}</p>}
      {row.metrics.length > 0 && <table className="sf-tp-table" aria-label={`Case ${row.number} metrics`}>
        <thead><tr><th>Metric</th><th>Expected</th><th>Actual</th><th>Score</th><th>Result</th></tr></thead>
        <tbody>{row.metrics.map((m, i) => <tr key={`${m.name}-${i}`}>
          <td>{orgMetricLabel(m.name)}</td><td>{m.expected ?? '—'}</td><td>{m.actual ?? '—'}</td>
          <td>{typeof m.score === 'number' ? m.score : '—'}</td>
          <td>{m.error ? `Error: ${m.error}` : m.result === 'pass' ? '✓ Pass' : m.result === 'fail' ? '✗ Fail' : 'Scored'}
            {m.explanation && <div className="sf-tp-sub">{m.explanation}</div>}</td>
        </tr>)}</tbody>
      </table>}
    </div>
  );
}
