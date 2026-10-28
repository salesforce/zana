import { useEffect, useRef, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { STUDIO_RPC, type ScenarioSuite } from '../../../lib/studio-contract.js';
import { agentSuitePath } from '../../../lib/graph-coverage.js';
import { failureReason } from '../../../lib/case-checks.js';
import { ScenarioCaseDetails } from '../preview/ScenarioCaseDetails.js';
import { TRACE_PANEL_STYLES } from '../preview/TracePanel.js';
import { runSuiteJob, SuiteStoppedError } from './suite-job-rpc.js';

export function suiteCounts(suite: ScenarioSuite) {
  const counts = { pass: 0, fail: 0, inconclusive: 0, pending: 0 };
  for (const scenario of suite.cases) counts[suite.lastResults?.[scenario.id]?.outcome ?? 'pending']++;
  return counts;
}

export interface FooterTestContext {
  pluginId: string; projectId?: string; threadId?: string;
  path: string | null; source: string; dirty: boolean;
}

const STYLES = `
.sf-footer-tests { font-size:12px; color:var(--sf-text); }
.sf-footer-tests-tools { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:8px; flex-wrap:wrap; padding:6px 10px; background:var(--sf-bg); border-bottom:1px solid var(--sf-border); }
.sf-footer-tests-summary { color:var(--sf-muted); }
.sf-footer-tests-failed { color:var(--sf-danger); }
.sf-footer-tests-search { margin-left:auto; min-width:100px; width:160px; max-width:100%; border:1px solid var(--sf-border); border-radius:5px; background:var(--sf-bg); color:var(--sf-text); padding:3px 6px; font:inherit; }
.sf-footer-tests summary { padding:6px 10px; cursor:pointer; overflow-wrap:anywhere; }
.sf-footer-tests summary:hover { background:var(--sf-soft); }
.sf-footer-tests summary:focus-visible, .sf-footer-tests-search:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-footer-tests summary .sf-problem-where { margin-left:10px; white-space:normal; }
.sf-footer-tests-cases { list-style:none; margin:0 10px 6px 24px; padding:0; }
.sf-footer-tests-case { border-bottom:1px solid var(--sf-border); }
.sf-footer-tests-row { display:flex; align-items:center; gap:8px; padding:4px 0; }
.sf-footer-tests-case-name { flex:1; min-width:0; overflow-wrap:anywhere; text-align:left; border:0; background:transparent; color:var(--sf-text); font:inherit; cursor:pointer; padding:3px; }
.sf-footer-tests-outcome { color:var(--sf-muted); font-size:11px; }
.sf-footer-tests-outcome[data-outcome=fail] { color:var(--sf-danger); }
.sf-footer-tests-outcome[data-outcome=pass] { color:var(--sf-success); }
.sf-footer-tests-reason { margin:0 3px 6px; color:var(--sf-muted); overflow-wrap:anywhere; }
.sf-footer-tests .sf-case-detail { padding:0 8px 10px; }
.sf-footer-tests .sf-case-detail-head { position:static; }
.sf-footer-tests-foot { margin:0; padding:6px 10px; color:var(--sf-muted); overflow-wrap:anywhere; }
.sf-footer-tests button[aria-pressed=true] { color:var(--sf-accent); border-color:var(--sf-accent); }
`;

/** Saved evidence stays inspectable for every suite; reruns use only the matching open editor. */
export function BottomTests({ suites, context, onOpenTests }: {
  suites: ScenarioSuite[]; context?: FooterTestContext; onOpenTests(): void;
}) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const controller = useRef(new AbortController());
  const runLock = useRef(false);
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const current = context?.path ? suites.find(suite => suite.path === agentSuitePath(context.path!)) : undefined;
  const failedIds = current?.cases.filter(scenario => current.lastResults?.[scenario.id]?.outcome === 'fail').map(scenario => scenario.id) ?? [];
  const counts = suites.reduce((all, suite) => {
    const next = suiteCounts(suite);
    for (const key of ['pass', 'fail', 'inconclusive', 'pending'] as const) all[key] += next[key];
    return all;
  }, { pass: 0, fail: 0, inconclusive: 0, pending: 0 });
  const running = busy || Boolean(current?.progress);
  const canRun = Boolean(context?.projectId && context.path && context.source.trim() && current && !running);
  const rpc = async (method: string, args: Record<string, unknown>) => {
    const reply = await callPluginRpc(context!.pluginId, method, { projectId: context!.projectId, agentPath: context!.path, ...args });
    return (reply ?? { ok: false, error: 'No response from Studio.' }) as { ok?: boolean; error?: string } & Record<string, unknown>;
  };
  async function rerun(caseIds: string[]) {
    if (!canRun || !current || !caseIds.length || runLock.current) return;
    runLock.current = true; setBusy(true); setNotice(null);
    const signal = controller.current.signal;
    try {
      const reply = await runSuiteJob(rpc, { path: current.path, source: context!.source, engine: 'preview', startedByUser: true,
        ...(context!.threadId ? { threadId: context!.threadId } : {}), caseIds }, signal, setJobId);
      if (!signal.aborted) setNotice(reply.ok === false
        ? { error: true, text: reply.error || 'The cases could not run.' }
        : { error: false, text: 'Rerun complete. Results saved.' });
    } catch (error) {
      if (!signal.aborted) setNotice({ error: !(error instanceof SuiteStoppedError), text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (!signal.aborted) { runLock.current = false; setBusy(false); setJobId(null); setStopping(false); }
    }
  }
  async function stop() {
    if (!jobId || stopping) return;
    setStopping(true);
    try {
      const reply = await rpc(STUDIO_RPC.suiteStop, { jobId });
      if (reply.ok === false) throw Error(reply.error || 'Could not stop the suite.');
    } catch (error) {
      if (!controller.current.signal.aborted) setNotice({ error: true, text: error instanceof Error ? error.message : String(error) });
    } finally { if (!controller.current.signal.aborted) setStopping(false); }
  }
  const query = search.trim().toLowerCase();
  const shown = suites.map(suite => ({ suite, cases: suite.cases.filter(scenario =>
    (!failedOnly || suite.lastResults?.[scenario.id]?.outcome === 'fail') &&
    (!query || `${suite.path} ${scenario.name} ${scenario.id}`.toLowerCase().includes(query)))
  })).filter(row => row.cases.length > 0 || (!query && !failedOnly && row.suite.cases.length === 0));

  return <section className="sf-footer-tests" data-testid="studio-tests-pane" aria-label="Saved scenario results">
    <style>{STYLES}{TRACE_PANEL_STYLES}</style>
    <div className="sf-footer-tests-tools">
      <span className="sf-footer-tests-summary">{counts.pass} passed{counts.fail > 0 && <> · <span className="sf-footer-tests-failed">{counts.fail} failed</span></>}{counts.inconclusive > 0 && ` · ${counts.inconclusive} inconclusive`}{counts.pending > 0 && ` · ${counts.pending} not run`}</span>
      <button type="button" className="sf-btn-small" aria-pressed={failedOnly} onClick={() => setFailedOnly(value => !value)}>Failed only</button>
      <input className="sf-footer-tests-search" type="search" aria-label="Search scenario cases" placeholder="Search cases…" value={search} onChange={event => setSearch(event.target.value)} />
      {current && failedIds.length > 0 && <button type="button" className="sf-btn-small" disabled={!canRun} onClick={() => void rerun(failedIds)} title="Rerun failing cases for the open agent in Simulate">Rerun failed ({failedIds.length})</button>}
      {jobId && <button type="button" className="sf-btn-small" disabled={stopping} onClick={() => void stop()}>{stopping ? 'Stopping…' : 'Stop suite'}</button>}
      <button type="button" className="sf-btn-small" onClick={onOpenTests}>Open Tests</button>
    </div>
    {notice && <p className="sf-footer-tests-foot" role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    {running && <p className="sf-footer-tests-foot" role="status">{current?.progress ? `Running · ${current.progress.completed}/${current.progress.caseIds.length} cases complete` : 'Starting rerun…'}</p>}
    {!suites.length ? <p className="sf-problems-empty">No scenario suites yet. Save a conversation as a scenario from Preview, or add tests/&lt;name&gt;.scenario.json.</p>
      : !shown.length ? <p className="sf-problems-empty">{query ? 'No matching cases.' : 'No failing cases.'}</p>
      : shown.map(({ suite, cases }) => {
        const summary = suiteCounts(suite);
        return <details key={suite.path} onToggle={event => {
          const open = event.currentTarget.open;
          setExpanded(paths => { const next = new Set(paths); if (open) next.add(suite.path); else next.delete(suite.path); return next; });
        }}>
          <summary><span className={summary.fail ? 'sf-footer-tests-failed' : ''}>{summary.fail ? '✕' : summary.pass === suite.cases.length && summary.pass > 0 ? '✓' : '○'}</span> {suite.path.split('/').pop()} · {suite.cases.length} {suite.cases.length === 1 ? 'case' : 'cases'}
            <span className="sf-problem-where">{summary.pass} passed{summary.fail ? ` · ${summary.fail} failed` : ''}{summary.inconclusive ? ` · ${summary.inconclusive} inconclusive` : ''}{summary.pending ? ` · ${summary.pending} not run` : ''}</span>
          </summary>
          {expanded.has(suite.path) && <ul className="sf-footer-tests-cases">{cases.map(scenario => {
            const result = suite.lastResults?.[scenario.id];
            const key = `${suite.path}:${scenario.id}`;
            const open = selected === key;
            const reason = result?.outcome === 'fail' ? failureReason(result) : '';
            return <li key={scenario.id} className="sf-footer-tests-case">
              <div className="sf-footer-tests-row"><button type="button" className="sf-footer-tests-case-name" aria-expanded={open} onClick={event => { selectedButton.current = event.currentTarget; setSelected(open ? null : key); }}>{scenario.name}</button>
                <span className="sf-footer-tests-outcome" data-outcome={result?.outcome}>{result ? { pass: 'Passed', fail: 'Failed', inconclusive: 'Inconclusive' }[result.outcome] : 'Not run'}</span>
                {current?.path === suite.path && <button type="button" className="sf-btn-small" disabled={!canRun} aria-label={`Rerun ${scenario.name}`} onClick={() => void rerun([scenario.id])}>Rerun</button>}
              </div>
              {reason && !open && <p className="sf-footer-tests-reason">{reason}</p>}
              {open && context && <ScenarioCaseDetails key={key} pluginId={context.pluginId} projectId={context.projectId} scenario={scenario} result={result} onClose={() => { setSelected(null); selectedButton.current?.focus(); }} />}
            </li>;
          })}</ul>}
          {!suite.cases.length && <p className="sf-footer-tests-foot">This suite has no cases.</p>}
        </details>;
      })}
    {current && <p className="sf-footer-tests-foot">Reruns use Simulate with the open agent’s editor source{context?.dirty ? ', including unsaved changes' : ''}.</p>}
  </section>;
}
