import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callPluginRpc, experimental_requestApproval, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import {
  ORG_TESTS_CHANGED_KIND, ORG_TESTS_LIMITS, ORG_TESTS_RPC, definitionImportText, isOrgRunTerminal,
  type OrgRunRecord, type OrgRunResults, type OrgTestDefinition, type OrgTestDefinitionSummary, type OrgTestCase
} from '../../../lib/org-tests-contract.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC } from '../../../lib/studio-contract.js';
import { RELEASE_RPC, type ReleasePrepared } from '../../../lib/release-contract.js';
import { declined, type Message } from './ReleasePane.js';
import { OrgRunDetail } from './OrgRunDetail.js';
import { agentNameFromPath, filterDefinitions, passRate, percent, relativeTime, sparkSeries } from './org-tests-model.js';

/** The Org tests view: the org's Testing Center definitions, their runs, and one run's results. */
export interface OrgTestsViewProps {
  pluginId: string;
  projectId?: string;
  threadId?: string;
  path: string | null;
  visible: boolean;
  onAskAgent?(prompt: string): void;
  call?: typeof callPluginRpc;
  requestApproval?: typeof experimental_requestApproval;
  /** Poll interval for a running run. */
  pollMs?: number;
  /** A request (agent ui.command or a click elsewhere) to show a definition and/or run; handled once per seq. */
  focus?: OrgTestsFocus | null;
  onFocusHandled?(seq: number): void;
}
export interface OrgTestsFocus { name?: string; runId?: string; seq: number }

type Reply = { ok?: boolean; code?: string; error?: string } & Record<string, unknown>;
type Notice = Message & { allowReads?: boolean };
interface OrgInfo { alias: string; id?: string; isProduction?: boolean }

export const ORG_POLL_MS = 3000;
const RUN_ID = /^[A-Za-z0-9]{15,18}$/;
const DEFINITION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

const STYLES = `
.sf-ot { display: flex; flex-direction: column; gap: 10px; }
.sf-ot .sf-tp-bar { align-items: center; }
.sf-ot .sf-tp-head h3 { margin: 0; font-size: 13px; }
.sf-ot-run { display: flex; flex-direction: column; gap: 10px; }
.sf-ot-field { display: inline-flex; align-items: center; gap: 6px; color: var(--sf-muted); }
.sf-ot-field input, .sf-ot-field select { font: inherit; color: var(--sf-text); background: var(--sf-sunken); border: 1px solid var(--sf-border); border-radius: 6px; padding: 3px 6px; }
.sf-ot-check { display: inline-flex; gap: 4px; align-items: center; }
.sf-ot-link { border: 0; background: none; color: var(--sf-text); font: inherit; text-align: left; cursor: pointer; padding: 0; }
.sf-ot-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.sf-ot-metrics { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.sf-ot-metrics li { display: flex; gap: 8px; align-items: center; }
.sf-ot-metrics li > span:first-child { width: 150px; color: var(--sf-muted); }
.sf-ot-bar { display: inline-block; width: 120px; height: 6px; border-radius: 3px; background: var(--sf-sunken); overflow: hidden; }
.sf-ot-bar > span { display: block; height: 100%; background: var(--sf-success); }
.sf-ot-spark { vertical-align: middle; }
.sf-ot-confirm { border: 1px solid var(--sf-accent); border-radius: 8px; padding: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.sf-ot-cases { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.sf-ot-cases li { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.sf-ot-case { display: flex; flex-direction: column; gap: 6px; }
.sf-ot-case p { margin: 0; }
.sf-tp-chip.is-pending, .sf-tp-chip.is-status-in_progress, .sf-tp-chip.is-status-new { border-color: var(--sf-accent); color: var(--sf-accent); }
.sf-tp-chip.is-status-completed { border-color: var(--sf-success); color: var(--sf-success); }
.sf-tp-chip.is-status-error, .sf-tp-chip.is-status-terminated { border-color: var(--sf-danger); color: var(--sf-danger); }
`;
export const ORG_TESTS_STYLES = STYLES;

function Spark({ rates }: { rates: number[] }) {
  if (rates.length < 2) return null;
  const w = 60, h = 16;
  const points = rates.map((r, i) => `${Math.round((i / (rates.length - 1)) * w)},${Math.round((1 - r) * (h - 2)) + 1}`).join(' ');
  return <svg className="sf-ot-spark" width={w} height={h} role="img" aria-label={`Pass rate trend: ${rates.map(rate => percent(rate)).join(', ')}`}>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>;
}

export function OrgTestsView(props: OrgTestsViewProps) {
  const { pluginId, projectId, threadId, path, visible, onAskAgent } = props;
  const call = props.call ?? callPluginRpc;
  const requestApproval = props.requestApproval ?? experimental_requestApproval;
  const pollMs = props.pollMs ?? ORG_POLL_MS;
  const agent = agentNameFromPath(path);

  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [defs, setDefs] = useState<OrgTestDefinitionSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [runs, setRuns] = useState<OrgRunRecord[]>([]);
  const [query, setQuery] = useState('');
  const [thisAgent, setThisAgent] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [definition, setDefinition] = useState<OrgTestDefinition | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<OrgRunResults | null>(null);
  const [previous, setPrevious] = useState<OrgRunResults | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const [attachId, setAttachId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const alive = useRef(true);
  const listSeq = useRef(0);
  const runSeq = useRef(0);
  const defSeq = useRef(0);
  const polling = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const rpc = useCallback(async (method: string, args: Record<string, unknown> = {}): Promise<Reply> => {
    const reply = await call(pluginId, method, { ...(projectId ? { projectId } : {}), ...args }) as Reply | null;
    return reply ?? { ok: false, error: 'No response.' };
  }, [call, pluginId, projectId]);

  const loadRuns = useCallback(async () => {
    try {
      const reply = await rpc(ORG_TESTS_RPC.runs);
      if (alive.current && reply.ok !== false && Array.isArray(reply.runs)) setRuns(reply.runs as OrgRunRecord[]);
    } catch { /* the list still works without history */ }
  }, [rpc]);

  const loadList = useCallback(async (refresh = false) => {
    const seq = ++listSeq.current;
    try {
      const reply = await rpc(ORG_TESTS_RPC.list, refresh ? { refresh: true } : {});
      if (!alive.current || seq !== listSeq.current) return;
      if (reply.ok === false) {
        setDefs(current => current ?? []);
        // A production or unknown org is read only after the user allows reads for it.
        if (reply.code === 'refused') {
          setListError(null);
          setNotice({ tone: 'error', text: 'This org is production or unknown. Allow reads to list its org tests.', allowReads: true });
        } else setListError(reply.error || 'Could not list the org tests.');
        return;
      }
      setListError(null);
      setNotice(current => (current?.allowReads ? null : current));
      setOrg((reply.org as OrgInfo | undefined) ?? null);
      setDefs(Array.isArray(reply.definitions) ? reply.definitions as OrgTestDefinitionSummary[] : []);
    } catch (error) {
      if (alive.current && seq === listSeq.current) { setListError(error instanceof Error ? error.message : String(error)); setDefs(current => current ?? []); }
    }
  }, [rpc]);

  useEffect(() => { if (visible) { void loadList(); void loadRuns(); } }, [visible, loadList, loadRuns]);

  const runsFor = useMemo(() => (name: string) => runs.filter(r => r.definition === name), [runs]);

  /** Loads a run's results, plus the previous finished run of the same definition for the diff. */
  const openRun = useCallback(async (id: string, history: OrgRunRecord[] = runs) => {
    const seq = ++runSeq.current;
    setRunId(id); setPollFailed(false);
    try {
      const reply = await rpc(ORG_TESTS_RPC.run, { runId: id });
      if (!alive.current || seq !== runSeq.current) return;
      if (reply.ok === false || !reply.run) { setNotice({ tone: 'error', text: reply.error || 'Could not read the run.' }); return; }
      const next = reply.run as OrgRunResults;
      setRun(next);
      const older = history.filter(r => r.definition === next.definition && r.runId !== id && r.startedAt <= next.startedAt && r.status === 'completed')[0];
      if (!older) { setPrevious(null); return; }
      const before = await rpc(ORG_TESTS_RPC.run, { runId: older.runId });
      if (alive.current && seq === runSeq.current) setPrevious(before.ok !== false && before.run ? before.run as OrgRunResults : null);
    } catch (error) {
      if (alive.current && seq === runSeq.current) setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }, [rpc, runs]);

  /** Resolves true when this selection is still the current one after loading. */
  const select = useCallback(async (name: string): Promise<boolean> => {
    const seq = ++defSeq.current;
    const runToken = ++runSeq.current;
    setSelected(name); setDefinition(null); setRun(null); setPrevious(null); setRunId(null); setConfirming(false); setNotice(null); setPollFailed(false);
    const current = () => alive.current && seq === defSeq.current && runToken === runSeq.current;
    try {
      const reply = await rpc(ORG_TESTS_RPC.definition, { name });
      if (!current()) return false;
      if (reply.ok === false || !reply.definition) setNotice({ tone: 'error', text: reply.error || 'Could not read the test definition.' });
      else {
        const loaded = reply.definition as OrgTestDefinition;
        setDefinition(loaded);
        // The list row gains what only the definition knows: label, agent and case count.
        setDefs(rows => rows?.map(row => row.name === loaded.name
          ? { ...row, label: loaded.label, subjectName: loaded.subjectName, subjectType: loaded.subjectType, subjectVersion: loaded.subjectVersion, caseCount: loaded.caseCount ?? loaded.testCases.length }
          : row) ?? rows);
      }
      return true;
    } catch (error) {
      if (!current()) return false;
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }, [rpc]);

  // A focus request selects its definition first (which clears the open run), then opens its run.
  const focus = props.focus;
  const onFocusHandled = props.onFocusHandled;
  const focusSeen = useRef(0);
  useEffect(() => {
    if (!focus || !visible || focus.seq === focusSeen.current) return;
    focusSeen.current = focus.seq;
    onFocusHandled?.(focus.seq);
    void (async () => {
      if (focus.name && !await select(focus.name)) return;
      if (!focus.runId) return;
      const reply = await rpc(ORG_TESTS_RPC.runs);
      const history = reply.ok !== false && Array.isArray(reply.runs) ? reply.runs as OrgRunRecord[] : runs;
      if (!alive.current) return;
      setRuns(history);
      const record = history.find(row => row.runId === focus.runId);
      if (!focus.name && record && record.definition !== 'unknown' && !await select(record.definition)) return;
      await openRun(focus.runId, history);
    })();
  }, [focus, visible, onFocusHandled, select, openRun, rpc, runs]);

  // Poll the open run while it is unfinished and the view is on screen.
  const runStatus = run?.status;
  const openId = run?.runId;
  useEffect(() => {
    if (!visible || pollFailed || !openId || !runStatus || isOrgRunTerminal(runStatus)) return undefined;
    const timer = setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      void rpc(ORG_TESTS_RPC.run, { runId: openId }).then(reply => {
        if (!alive.current) return;
        if (reply.ok !== false && reply.run) {
          const next = reply.run as OrgRunResults;
          setRun(current => (current && current.runId === next.runId ? next : current));
          if (isOrgRunTerminal(next.status)) void loadRuns();
        } else {
          setPollFailed(true);
          setNotice({ tone: 'error', text: reply.error || 'Could not refresh the run.' });
        }
      }).catch(error => {
        if (!alive.current) return;
        setPollFailed(true);
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
      }).finally(() => { polling.current = false; });
    }, pollMs);
    return () => clearInterval(timer);
  }, [visible, pollFailed, openId, runStatus, pollMs, rpc, loadRuns]);

  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const row = payload as { kind?: string; projectId?: string; runId?: string } | null;
    if (!row || row.kind !== ORG_TESTS_CHANGED_KIND || (row.projectId && row.projectId !== projectId) || !visible) return;
    void loadRuns();
    if (row.runId && row.runId === openId && runStatus && !isOrgRunTerminal(runStatus)) void openRun(row.runId);
  });

  const perform = useCallback(async (key: string, work: () => Promise<Notice | null>) => {
    setBusy(key); setNotice(null);
    try {
      const next = await work();
      if (alive.current && next) setNotice(next);
    } catch (error) {
      if (alive.current) setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (alive.current) setBusy(null);
    }
  }, []);

  const startRun = useCallback(async (name: string): Promise<Notice | null> => {
    const reply = await rpc(ORG_TESTS_RPC.start, { name, via: 'studio', ...(threadId ? { threadId } : {}) });
    if (reply.ok === false) {
      // On a production or unknown org a run confirms as an org write, which a read grant never covers.
      if (reply.code === 'refused') return { tone: 'error', text: threadId ? 'The run on this production or unknown org was not approved.' : 'This org is production or unknown. Start the run from a thread so you can approve it.' };
      return { tone: 'error', text: reply.error || 'The run could not start.' };
    }
    const started = reply.run as OrgRunRecord;
    if (!alive.current) return null;
    const history = [started, ...runs.filter(r => r.runId !== started.runId)];
    setRuns(history);
    setRun({ ...started, cases: [] }); setPrevious(null); setRunId(started.runId); setPollFailed(false);
    void openRun(started.runId, history);
    return { tone: 'ok', text: `Started run ${started.runId}.` };
  }, [rpc, threadId, runs, openRun]);

  const confirmRun = () => { setConfirming(false); if (selected) void perform('start', () => startRun(selected)); };

  const allowReads = () => perform('reads', async () => {
    const prepared = await rpc(RELEASE_RPC.prepare, { ...(path ? { path } : {}), action: 'org.read' }) as Reply & { data?: ReleasePrepared };
    if (prepared.ok === false && prepared.code !== 'not_needed') return { tone: 'error', text: prepared.error || 'Could not prepare the approval.' };
    if (prepared.ok !== false && prepared.data) {
      const answer = await requestApproval(pluginId, prepared.data.request);
      if (!answer.approved) return declined(answer.reason);
      const granted = await rpc(RELEASE_RPC.run, { ...(path ? { path } : {}), action: 'org.read', token: answer.token });
      if (granted.ok === false) return { tone: 'error', text: granted.error || 'The approval was not accepted.' };
    }
    await Promise.all([loadList(true), loadRuns()]);
    return { tone: 'ok', text: 'Reads allowed for this org.' };
  });

  const cancelRun = () => perform('cancel', async () => {
    if (!run) return null;
    const reply = await rpc(ORG_TESTS_RPC.cancel, { runId: run.runId });
    if (reply.ok === false) return { tone: 'error', text: reply.error || 'The run could not be cancelled.' };
    const rec = reply.run as OrgRunRecord;
    if (alive.current) { setRun(current => (current ? { ...current, ...rec } : current)); void loadRuns(); }
    return { tone: 'muted', text: `Cancelled run ${run.runId}.` };
  });

  const attachRun = () => {
    const id = attachId.trim();
    if (!id) { setNotice({ tone: 'error', text: 'Enter a run id.' }); return; }
    if (!RUN_ID.test(id)) { setNotice({ tone: 'error', text: 'A run id is 15 to 18 letters and digits.' }); return; }
    void perform('attach', async () => {
      const defToken = defSeq.current;
      const runToken = runSeq.current;
      const reply = await rpc(ORG_TESTS_RPC.attach, { runId: id });
      if (reply.ok === false || !reply.run) return { tone: 'error', text: reply.error || 'The run could not be attached.' };
      const attached = reply.run as OrgRunResults;
      if (!alive.current) return null;
      setAttachId('');
      void loadRuns();
      const notice: Notice = { tone: 'ok', text: `Attached run ${attached.runId}.` };
      // The user picked something else while the attach was in flight: keep their choice.
      if (defToken !== defSeq.current || runToken !== runSeq.current) return notice;
      const show = () => { setRun(attached); setPrevious(null); setRunId(attached.runId); setPollFailed(false); };
      if (attached.definition !== 'unknown' && DEFINITION_NAME.test(attached.definition)) {
        if (attached.definition !== selected) {
          const settled = await select(attached.definition);
          if (settled && alive.current) { ++runSeq.current; show(); }
          return notice;
        }
      }
      ++runSeq.current;
      show();
      return notice;
    });
  };

  const importCases = (name: string, label: string | undefined, cases: readonly OrgTestCase[], key: string) => {
    if (!path) { setNotice({ tone: 'error', text: 'Open an agent file to import into its suite.' }); return; }
    const capped = cases.slice(0, ORG_TESTS_LIMITS.suiteCases);
    void perform(key, async () => {
      const reply = await rpc(STUDIO_RPC.suiteImport, { agentPath: path, text: definitionImportText({ name, label: label ?? '' }, capped) });
      if (reply.ok === false) return { tone: 'error', text: reply.error || 'The cases could not be imported.' };
      const n = Number(reply.imported) || capped.length;
      const cut = cases.length - capped.length;
      return { tone: 'ok', text: `Imported ${n} case${n === 1 ? '' : 's'} into the suite.${cut > 0 ? ` A suite holds ${ORG_TESTS_LIMITS.suiteCases} cases, so ${cut} were left out.` : ''}` };
    });
  };

  const visibleDefs = filterDefinitions(defs ?? [], { query, agent: thisAgent ? agent : null });
  const active = run && !isOrgRunTerminal(run.status);
  const working = busy !== null;
  const history = selected ? runsFor(selected) : [];

  return (
    <div className="sf-ot" data-testid="org-tests-view">
      <style>{STYLES}</style>
      <div className="sf-tp-bar">
        <label className="sf-ot-field">Filter org tests<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, label or agent" /></label>
        <label className="sf-ot-check"><input type="checkbox" checked={thisAgent} disabled={!agent} onChange={e => setThisAgent(e.target.checked)} /> This agent{agent ? ` (${agent})` : ''}</label>
        <button type="button" className="sf-tp-btn" onClick={() => void loadList(true)}>Refresh</button>
        <span className="sf-tp-spacer" />
        <span className="sf-tp-sub">{org ? `${org.alias}${org.isProduction ? ' (production)' : ''} · ` : ''}{defs ? `${visibleDefs.length} of ${defs.length} tests` : 'Loading…'}</span>
      </div>
      <div className="sf-tp-bar">
        <label className="sf-ot-field">Attach run by id<input value={attachId} onChange={e => setAttachId(e.target.value)} placeholder="Run id from Testing Center or CI" /></label>
        <button type="button" className="sf-tp-btn" disabled={working} onClick={attachRun}>Attach</button>
      </div>
      {listError && <div className="sf-tp-message is-error" role="alert">{listError}</div>}
      {notice && <div className={`sf-tp-message is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
        <span>{notice.text}</span>
        {notice.allowReads && <button type="button" className="sf-tp-btn" disabled={working} onClick={() => void allowReads()}>Allow reads…</button>}
      </div>}
      {defs && !visibleDefs.length && !listError && <div className="sf-tp-empty">{defs.length ? 'No org tests match.' : 'This org has no test definitions.'}</div>}
      {visibleDefs.length > 0 && <table className="sf-tp-table" data-testid="org-tests-table">
        <thead><tr><th>Test</th><th>Agent</th><th>Cases</th><th>Last run</th><th>Trend</th></tr></thead>
        <tbody>{visibleDefs.map(def => {
          const mine = runsFor(def.name);
          const last = mine[0];
          return <tr key={def.name} className="sf-tp-row" data-testid={`org-def-${def.name}`} aria-selected={selected === def.name}>
            <td><button type="button" className="sf-ot-link sf-tp-name" aria-pressed={selected === def.name} onClick={() => void select(def.name)}>{def.label || def.name}</button>
              {def.label && def.label !== def.name && <div className="sf-tp-sub">{def.name}</div>}</td>
            <td className="sf-tp-sub">{def.subjectName ?? '—'}</td>
            <td>{def.caseCount ?? '—'}</td>
            <td>{last ? <>{last.status.replace('_', ' ')} · {percent(passRate(last.counts))} · <span className="sf-tp-sub">{relativeTime(last.startedAt)}</span></> : <span className="sf-tp-sub">No runs</span>}</td>
            <td><Spark rates={sparkSeries(mine)} /></td>
          </tr>;
        })}</tbody>
      </table>}

      {selected && <section className="sf-ot" aria-label={`Test ${selected}`} data-testid="org-def-detail">
        <div className="sf-tp-head">
          <h3>{definition?.label || selected}</h3>
          {definition && <span className="sf-tp-sub">{definition.testCases.length} case{definition.testCases.length === 1 ? '' : 's'}{definition.truncated ? ' (truncated)' : ''}</span>}
          <span className="sf-tp-spacer" />
          <button type="button" className="sf-tp-btn is-primary" disabled={working || Boolean(active)} onClick={() => setConfirming(true)}>{busy === 'start' || busy === 'reads' ? 'Starting…' : 'Run in org'}</button>
          <button type="button" className="sf-tp-btn" disabled={working || !definition?.testCases.length || !path}
            title={!path ? 'Open an agent file to import into its suite.' : undefined}
            onClick={() => definition && importCases(definition.name, definition.label, definition.testCases, 'import')}>Import to suite</button>
          {active && <button type="button" className="sf-tp-btn" disabled={working} onClick={() => void cancelRun()}>Cancel run</button>}
        </div>
        {confirming && <div className="sf-ot-confirm" role="group" aria-label="Confirm run">
          <span>Run {selected} in {org?.alias ?? 'the org'}? This uses org evaluation resources.</span>
          <button type="button" className="sf-tp-btn is-primary" onClick={confirmRun}>Start run</button>
          <button type="button" className="sf-tp-btn" onClick={() => setConfirming(false)}>Not now</button>
        </div>}
        {history.length > 0 && <div className="sf-tp-bar" role="group" aria-label="Run history">
          {history.slice(0, 8).map(r => <button key={r.runId} type="button" className="sf-tp-btn" aria-pressed={runId === r.runId} onClick={() => void openRun(r.runId)}>
            {r.runId} · {r.status.replace('_', ' ')} · {percent(passRate(r.counts))} · {relativeTime(r.startedAt)}
          </button>)}
        </div>}
        {definition && <ul className="sf-ot-cases" aria-label="Test cases">{definition.testCases.slice(0, 50).map(c => <li key={c.number}>
          <strong>#{c.number}</strong> {c.utterance}
          {c.expectations.map((e, i) => <span key={i} className="sf-tp-chip" title={e.expectedValue}>{e.name}{e.expectedValue ? `: ${e.expectedValue.slice(0, 40)}` : ''}</span>)}
          {c.contextVariables.length > 0 && <span className="sf-tp-sub"> · context {c.contextVariables.map(v => v.name).join(', ')}</span>}
        </li>)}</ul>}
      </section>}
      {run && <OrgRunDetail run={run} previous={previous} definitionCases={definition?.testCases} path={path} busy={working}
        onImport={cases => importCases(run.definition, definition?.label, cases, 'import-run')} onAskAgent={onAskAgent} />}

    </div>
  );
}
