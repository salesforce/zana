import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { callPluginRpc, experimental_requestApproval, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import {
  ORG_TESTS_CHANGED_KIND, ORG_TESTS_LIMITS, ORG_TESTS_RPC, definitionImportText, isOrgRunTerminal,
  type OrgRunRecord, type OrgRunResults, type OrgTestDefinition, type OrgTestDefinitionSummary, type OrgTestCase
} from '../../../lib/org-tests-contract.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type ScenarioSuite } from '../../../lib/studio-contract.js';
import { RELEASE_RPC, type ReleasePrepared } from '../../../lib/release-contract.js';
import { declined, type Message } from './approval-notice.js';
import { OrgRunDetail } from './OrgRunDetail.js';
import { ORG_CASE_TABLE_STYLES, OrgCaseTable } from './OrgCaseTable.js';
import { agentNameFromPath, filterDefinitions, groupDefinitions, passRate, percent, relativeTime, sameAgent, sparkSeries } from './org-tests-model.js';

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
  /** The same local case editor used by the side panel. Local reads are independent of org reads. */
  renderLocalSuite?(suite: ScenarioSuite): ReactNode;
}
export interface OrgTestsFocus { name?: string; runId?: string; seq: number }

type Reply = { ok?: boolean; code?: string; error?: string } & Record<string, unknown>;
type Notice = Message & { allowReads?: boolean };
interface OrgInfo { alias: string; id?: string; isProduction?: boolean }

export const ORG_POLL_MS = 3000;
const RUN_ID = /^[A-Za-z0-9]{15,18}$/;
const DEFINITION_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;

const STYLES = `
.sf-tp.is-org-tests { padding: 0; gap: 0; overflow: hidden; }
.sf-ot { display: flex; flex-direction: column; flex: 1; min-height: 0; container-type: inline-size; color: var(--sf-text); }
.sf-ot-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--sf-border); }
.sf-ot-top h2 { margin: 0; font-size: 13px; }
.sf-ot-org { font-size: 11px; color: var(--sf-muted); border: 1px solid var(--sf-border); border-radius: 999px; padding: 0 8px; white-space: nowrap; }
.sf-ot-org.is-production { border-color: var(--sf-warn, var(--sf-danger)); color: var(--sf-warn, var(--sf-danger)); }
.sf-ot-search { width: 240px; max-width: 100%; font: inherit; color: var(--sf-text); background: var(--sf-sunken); border: 1px solid var(--sf-border); border-radius: 6px; padding: 3px 8px; }
.sf-ot-search:focus { outline: none; border-color: var(--sf-accent); }
.sf-ot-toolbar {flex-wrap: wrap; align-items: center; gap: 8px;}
.sf-ot-tabs {display: flex; gap: 4px; flex-wrap: wrap;}
.sf-ot-select { font: inherit; color: var(--sf-text); background: var(--sf-sunken); border: 1px solid var(--sf-border); border-radius: 6px; padding: 3px 6px; }
.sf-ot-select:focus { outline: none; border-color: var(--sf-accent); }
.sf-ot-toggle[aria-pressed="true"] { background: var(--sf-soft); border-color: var(--sf-accent); color: var(--sf-accent); }
.sf-ot-icon { min-width: 26px; padding: 3px 6px; }
.sf-ot-menu { position: relative; }
.sf-ot-pop { position: absolute; right: 0; top: calc(100% + 4px); width: 300px; z-index: 5; background: var(--sf-elevated); border: 1px solid var(--sf-border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.sf-ot-pop label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--sf-muted); }
.sf-ot-pop input { font: inherit; color: var(--sf-text); background: var(--sf-sunken); border: 1px solid var(--sf-border); border-radius: 6px; padding: 3px 6px; }
.sf-ot-notices { display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 0; }
.sf-ot-notices:empty { display: none; }
.sf-ot-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(260px, 420px) minmax(0, 1fr); }
.sf-ot-side { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--sf-border); background: var(--sf-surface, transparent); }
.sf-ot-list { flex: 1; min-height: 0; overflow: auto; }
.sf-ot-source { margin: 0; padding: 8px 12px; font-size: 11px; color: var(--sf-muted); border-bottom: 1px solid var(--sf-border); }
.sf-ot-scope { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--sf-border); }
.sf-ot-scope strong { font-size: 12px; }
.sf-ot-group { border-bottom: 1px solid var(--sf-border); }
.sf-ot-ghead { display: flex; width: 100%; align-items: center; gap: 6px; padding: 6px 12px; border: 0; background: none; color: var(--sf-muted); font: inherit; font-size: 11px; font-weight: 600; letter-spacing: .04em; cursor: pointer; text-align: left; }
.sf-ot-ghead:hover { color: var(--sf-text); }
.sf-ot-chev { width: 10px; font-size: 9px; transition: transform .12s; }
.sf-ot-ghead[aria-expanded="false"] .sf-ot-chev { transform: rotate(-90deg); }
.sf-ot-count { margin-left: auto; font-weight: 500; letter-spacing: 0; white-space: nowrap; }
.sf-ot-badge { font-size: 10px; font-weight: 500; letter-spacing: 0; border-radius: 999px; padding: 0 6px; border: 1px solid var(--sf-accent); color: var(--sf-accent); }
.sf-ot-rows { list-style: none; margin: 0; padding: 0; }
.sf-ot-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 6px 12px 6px 26px; border-left: 2px solid transparent; cursor: pointer; }
.sf-ot-flat .sf-ot-row { padding-left: 12px; }
.sf-ot-row:hover { background: var(--sf-soft); }
.sf-ot-row[aria-selected="true"] { background: var(--sf-soft); border-left-color: var(--sf-accent); }
.sf-ot-link { border: 0; background: none; color: var(--sf-text); font: inherit; font-weight: 500; text-align: left; cursor: pointer; padding: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sf-ot-rowsub { grid-column: 1; display: flex; gap: 8px; align-items: center; min-width: 0; font-size: 11px; color: var(--sf-muted); }
.sf-ot-api { font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sf-ot-right { grid-row: 1 / span 2; grid-column: 2; display: flex; align-items: center; gap: 8px; }
.sf-ot-chip { font-size: 10.5px; border-radius: 999px; padding: 0 7px; line-height: 17px; white-space: nowrap; color: var(--sf-muted); }
.sf-ot-chip.is-good { color: var(--sf-success); border: 1px solid var(--sf-success); font-weight: 600; }
.sf-ot-chip.is-bad { color: var(--sf-danger); border: 1px solid var(--sf-danger); font-weight: 600; }
.sf-ot-chip.is-live { color: var(--sf-accent); border: 1px solid var(--sf-accent); font-weight: 600; }
.sf-ot-spark { display: inline-flex; gap: 2px; align-items: flex-end; height: 16px; }
.sf-ot-spark > i { width: 3px; border-radius: 1px; background: var(--sf-success); opacity: .85; }
.sf-ot-spark > i.is-low { background: var(--sf-danger); }
.sf-ot-shim { display: inline-block; height: 9px; border-radius: 4px; background: var(--sf-soft); animation: sf-ot-pulse 1.2s ease-in-out infinite; }
@keyframes sf-ot-pulse { 50% { opacity: .45; } }
.sf-ot-more { padding: 10px 12px; font-size: 12px; color: var(--sf-muted); border-top: 1px dashed var(--sf-border); }
.sf-ot-textbtn { border: 0; background: none; padding: 0; font: inherit; color: var(--sf-accent); cursor: pointer; }
.sf-ot-blank { padding: 32px 20px; text-align: center; color: var(--sf-muted); }
.sf-ot-blank h4 { margin: 0 0 6px; font-size: 13px; color: var(--sf-text); }
.sf-ot-blank p { margin: 0 auto 12px; max-width: 300px; font-size: 12px; }
.sf-ot-foot { display: flex; align-items: center; gap: 8px; padding: 5px 12px; font-size: 11px; color: var(--sf-muted); border-top: 1px solid var(--sf-border); }
.sf-ot-prog { width: 80px; height: 4px; border-radius: 2px; background: var(--sf-border); overflow: hidden; }
.sf-ot-prog > span { display: block; height: 100%; background: var(--sf-accent); transition: width .2s; }
.sf-ot-detail { min-width: 0; min-height: 0; overflow: auto; padding: 14px 18px; display: flex; flex-direction: column; gap: 12px; }
.sf-ot-dhead { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
.sf-ot-dhead h3 { margin: 0; font-size: 15px; }
.sf-ot-meta { display: flex; gap: 22px; flex-wrap: wrap; margin: 0; padding: 10px 14px; border: 1px solid var(--sf-border); border-radius: 8px; }
.sf-ot-meta > div { display: flex; flex-direction: column; gap: 2px; }
.sf-ot-meta dt { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--sf-muted); }
.sf-ot-meta dd { margin: 0; font-size: 13px; font-weight: 600; }
.sf-ot-sec { margin: 4px 0 -4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--sf-muted); }
.sf-ot-runs { display: flex; gap: 6px; flex-wrap: wrap; }
.sf-ot-runcard { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; min-width: 110px; border: 1px solid var(--sf-border); border-radius: 6px; padding: 5px 9px; background: none; color: var(--sf-text); font: inherit; font-size: 11px; cursor: pointer; text-align: left; }
.sf-ot-runcard:hover, .sf-ot-runcard[aria-pressed="true"] { border-color: var(--sf-accent); }
.sf-ot-runcard strong { font-size: 13px; }
.sf-ot-runcard small { color: var(--sf-muted); }
.sf-ot-empty { height: 100%; display: grid; place-items: center; color: var(--sf-muted); text-align: center; }
.sf-ot-run { display: flex; flex-direction: column; gap: 10px; }
.sf-ot-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.sf-ot-metrics { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.sf-ot-metrics li { display: flex; gap: 8px; align-items: center; }
.sf-ot-metrics li > span:first-child { width: 150px; color: var(--sf-muted); }
.sf-ot-bar { display: inline-block; width: 120px; height: 6px; border-radius: 3px; background: var(--sf-sunken); overflow: hidden; }
.sf-ot-bar > span { display: block; height: 100%; background: var(--sf-success); }
.sf-ot-confirm { border: 1px solid var(--sf-accent); border-radius: 8px; padding: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.sf-ot-case { display: flex; flex-direction: column; gap: 6px; }
.sf-ot-case p { margin: 0; }
.sf-tp-chip.is-pending, .sf-tp-chip.is-status-in_progress, .sf-tp-chip.is-status-new { border-color: var(--sf-accent); color: var(--sf-accent); }
.sf-tp-chip.is-status-completed { border-color: var(--sf-success); color: var(--sf-success); }
.sf-tp-chip.is-status-error, .sf-tp-chip.is-status-terminated { border-color: var(--sf-danger); color: var(--sf-danger); }
@container (max-width: 720px) {
  .sf-ot-body { grid-template-columns: minmax(0, 1fr); grid-auto-rows: auto; }
  .sf-ot-side { border-right: 0; border-bottom: 1px solid var(--sf-border); }
  .sf-ot-list { max-height: 50vh; }
  .sf-ot-detail { overflow: visible; padding: 12px; }
  .sf-ot-search { width: 100%; order: 10; }
}
${ORG_CASE_TABLE_STYLES}`;
export const ORG_TESTS_STYLES = STYLES;

/** A pass rate of at least this reads as healthy. */
const GOOD_RATE = 0.8;

function Spark({ rates }: { rates: number[] }) {
  if (rates.length < 2) return null;
  return <span className="sf-ot-spark" role="img" aria-label={`Pass rate trend: ${rates.map(rate => percent(rate)).join(', ')}`}>
    {rates.map((rate, i) => <i key={i} className={rate < GOOD_RATE ? 'is-low' : undefined} style={{ height: `${Math.max(2, Math.round(rate * 16))}px` }} />)}
  </span>;
}

function LastRun({ run }: { run: OrgRunRecord | undefined }) {
  if (!run) return <span className="sf-ot-chip">No runs</span>;
  if (!isOrgRunTerminal(run.status)) return <span className="sf-ot-chip is-live">Running…</span>;
  const rate = passRate(run.counts);
  if (rate === null) return <span className="sf-ot-chip">{run.status.replace('_', ' ')}</span>;
  return <span className={`sf-ot-chip ${rate >= GOOD_RATE ? 'is-good' : 'is-bad'}`} title={`${run.status.replace('_', ' ')} · ${relativeTime(run.startedAt)}`}>{percent(rate)}</span>;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
  const [scope, setScope] = useState<'this' | 'all'>('this');
  const [hasRuns, setHasRuns] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Groups the user opened or closed; the rest follow the default (only the first group open). */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Definitions whose agent is still being read, and those it could not be read for. */
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; unread: number } | null>(null);
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
  const localEnabled = Boolean(props.renderLocalSuite);
  const [localSuites, setLocalSuites] = useState<ScenarioSuite[] | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null);
  const localSeq = useRef(0);
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

  const loadLocal = useCallback(async () => {
    if (!localEnabled) return;
    const seq = ++localSeq.current;
    try {
      const reply = await rpc(STUDIO_RPC.suites);
      if (!alive.current || seq !== localSeq.current) return;
      if (reply.ok === false || !Array.isArray(reply.suites)) throw Error(reply.error || 'Could not read the local suites.');
      setLocalSuites(reply.suites as ScenarioSuite[]);
      setLocalError(null);
    } catch (error) {
      if (alive.current && seq === localSeq.current) {
        setLocalSuites(current => current ?? []);
        setLocalError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [localEnabled, rpc]);
  useEffect(() => {
    ++localSeq.current;
    setLocalSuites(null); setLocalError(null); setSelectedLocal(null);
    return () => { ++localSeq.current; };
  }, [rpc]);
  useEffect(() => { if (visible) void loadLocal(); }, [visible, loadLocal]);

  const loadRuns = useCallback(async () => {
    try {
      const reply = await rpc(ORG_TESTS_RPC.runs);
      if (alive.current && reply.ok !== false && Array.isArray(reply.runs)) setRuns(reply.runs as OrgRunRecord[]);
    } catch { /* the list still works without history */ }
  }, [rpc]);

  /**
   * Reads the agent, label and case count of every definition the list does not know yet, a batch per retrieve and three
   * retrieves at a time. A newer list load abandons it.
   */
  const loadDetails = useCallback(async (rows: readonly OrgTestDefinitionSummary[], seq: number) => {
    const names = rows.filter(row => !row.subjectName).map(row => row.name);
    const current = () => alive.current && seq === listSeq.current;
    setPending(new Set(names));
    setProgress(names.length ? { done: 0, total: names.length, unread: 0 } : null);
    if (!names.length) return;
    const batches: string[][] = [];
    for (let at = 0; at < names.length; at += ORG_TESTS_LIMITS.detailsBatch) batches.push(names.slice(at, at + ORG_TESTS_LIMITS.detailsBatch));
    let next = 0;
    let done = 0;
    let unread = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++]!;
        let found: OrgTestDefinitionSummary[] = [];
        try {
          const reply = await rpc(ORG_TESTS_RPC.details, { names: batch });
          if (reply.ok !== false && Array.isArray(reply.definitions)) found = reply.definitions as OrgTestDefinitionSummary[];
          // Reads were refused for this org: the rest would be refused too.
          else if (reply.code === 'refused') next = batches.length;
        } catch { /* the batch stays unread; the others still load */ }
        if (!current()) return;
        const byName = new Map(found.map(row => [row.name, row]));
        setDefs(list => list?.map(row => { const known = byName.get(row.name); return known ? { ...row, ...known } : row; }) ?? list);
        setPending(left => { const rest = new Set(left); for (const name of batch) rest.delete(name); return rest; });
        done += batch.length;
        unread += batch.filter(name => !byName.has(name)).length;
        setProgress({ done, total: names.length, unread });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (!current()) return;
    // Batches skipped after a refusal count as unread.
    setPending(new Set());
    setProgress({ done: names.length, total: names.length, unread: unread + names.length - done });
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
      const rows = Array.isArray(reply.definitions) ? reply.definitions as OrgTestDefinitionSummary[] : [];
      setDefs(rows);
      void loadDetails(rows, seq);
    } catch (error) {
      if (alive.current && seq === listSeq.current) { setListError(error instanceof Error ? error.message : String(error)); setDefs(current => current ?? []); }
    }
  }, [rpc, loadDetails]);

  useEffect(() => { if (visible) { void loadList(); void loadRuns(); } }, [visible, loadList, loadRuns]);

  const runsFor = useMemo(() => (name: string) => runs.filter(r => r.definition === name), [runs]);

  /** Loads a run's results, plus the previous finished run of the same definition for the diff. */
  const openRun = useCallback(async (id: string, history: OrgRunRecord[] = runs) => {
    setSelectedLocal(null);
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
    setSelectedLocal(null);
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
    setSelectedLocal(null);
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
    if (!row || (row.projectId && row.projectId !== projectId) || !visible) return;
    if (row.kind === 'suites' || row.kind === 'suite-progress') { void loadLocal(); return; }
    if (row.kind !== ORG_TESTS_CHANGED_KIND) return;
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
      setMenuOpen(false);
      void loadRuns();
      const notice: Notice = { tone: 'ok', text: `Attached run ${attached.runId}.` };
      // The user picked something else while the attach was in flight: keep their choice.
      if (defToken !== defSeq.current || runToken !== runSeq.current) return notice;
      const show = () => { setSelectedLocal(null); setRun(attached); setPrevious(null); setRunId(attached.runId); setPollFailed(false); };
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

  const active = run && !isOrgRunTerminal(run.status);
  const working = busy !== null;
  const history = selected ? runsFor(selected) : [];
  const all = defs ?? [];
  const scoped = Boolean(agent) && scope === 'this';
  const matching = filterDefinitions(all, { query }).filter(def => !hasRuns || runsFor(def.name).length > 0);
  const mine = agent ? matching.filter(def => sameAgent(def, agent)) : [];
  const shown = scoped ? mine : matching;
  const loadingAgents = pending.size > 0;
  const withRuns = (rows: readonly OrgTestDefinitionSummary[]) => rows.filter(def => runsFor(def.name).length > 0).length;
  /** "N tests", plus "· M with runs" only when some have runs: the org cannot list runs, so a zero says little. */
  const withRunsText = (rows: readonly OrgTestDefinitionSummary[], count: string) => { const n = withRuns(rows); return n > 0 ? `${count} · ${n} with runs` : count; };
  const others = agent ? all.filter(def => def.subjectName && !sameAgent(def, agent)).length : 0;
  const groups = scoped ? [] : groupDefinitions(matching, pending, agent);
  // A search shows every match; otherwise groups the user toggled keep their state, and only the pinned or first one opens.
  const groupOpen = (key: string, index: number) => Boolean(query.trim()) || (expanded[key] ?? (agent ? key === agent.toLowerCase() : index === 0));
  const selectedDef = selected ? all.find(def => def.name === selected) : undefined;
  const lastRun = history[0];
  const filtered = Boolean(query.trim()) || hasRuns;
  const localAll = localSuites ?? [];
  const localMatching = localAll.filter(suite => {
    if (scoped && suite.id.toLowerCase() !== agent?.toLowerCase()) return false;
    if (hasRuns && !suite.progress && !suite.lastEval && !suite.cases.some(c => suite.lastResults?.[c.id])) return false;
    const search = query.trim().toLowerCase();
    return !search || [suite.id, suite.path, ...suite.cases.flatMap(c => [c.name, ...c.utterances])].some(value => value.toLowerCase().includes(search));
  });
  const local = localAll.find(suite => suite.path === selectedLocal);
  const selectLocal = (suite: ScenarioSuite) => {
    ++defSeq.current; ++runSeq.current;
    setSelectedLocal(suite.path); setSelected(null); setDefinition(null); setRun(null); setPrevious(null); setRunId(null); setConfirming(false); setPollFailed(false);
  };

  const row = (def: OrgTestDefinitionSummary) => {
    const runsOf = runsFor(def.name);
    const reading = !def.subjectName && pending.has(def.name);
    const cases = def.caseCount ?? (definition?.name === def.name ? definition.testCases.length : undefined);
    return <li key={def.name} className="sf-ot-row" data-testid={`org-def-${def.name}`} aria-selected={selected === def.name} onClick={() => void select(def.name)}>
      <button type="button" className="sf-ot-link" aria-pressed={selected === def.name} onClick={event => { event.stopPropagation(); void select(def.name); }}>{def.label || def.name}</button>
      <span className="sf-ot-rowsub">
        {def.label && def.label !== def.name && <span className="sf-ot-api">{def.name}</span>}
        {cases !== undefined ? <span>{plural(cases, 'case')}</span> : reading ? <span className="sf-ot-shim" style={{ width: 44 }} aria-label="Reading definition" /> : null}
      </span>
      <span className="sf-ot-right"><Spark rates={sparkSeries(runsOf)} /><LastRun run={runsOf[0]} /></span>
    </li>;
  };

  const blank = (() => {
    if (!defs || listError) return null;
    if (!all.length) return <div className="sf-ot-blank"><h4>No org tests</h4><p>This org has no test definitions.</p></div>;
    if (scoped && !mine.length) {
      if (filtered) return <div className="sf-ot-blank"><p>No org tests for {agent} match.</p></div>;
      if (loadingAgents) return <div className="sf-ot-blank"><p>Looking for tests of {agent}…</p></div>;
      return <div className="sf-ot-blank" data-testid="org-tests-none-for-agent">
        <h4>No org tests for {agent} yet</h4>
        <p>None of the {plural(all.length, 'definition')} in {org?.alias ?? 'this org'} test this agent. Tests for other agents are still available.</p>
        <button type="button" className="sf-tp-btn" onClick={() => setScope('all')}>Browse all agents</button>
      </div>;
    }
    if (!scoped && !matching.length) return <div className="sf-ot-blank"><p>No org tests match.</p></div>;
    return null;
  })();

  return (
    <div className="sf-ot" data-testid="org-tests-view">
      <style>{STYLES}</style>
      <div className="sf-ot-top">
        <h2>{localEnabled ? 'Tests' : 'Org tests'}</h2>
        {org && <span className={`sf-ot-org${org.isProduction ? ' is-production' : ''}`} title={org.isProduction ? 'Production org' : undefined}>{org.alias}{org.isProduction ? ' (production)' : ''}</span>}
        <span className="sf-tp-spacer" />
        <input type="search" className="sf-ot-search" aria-label={localEnabled ? 'Filter tests' : 'Filter org tests'} value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter by name or label" />
        {agent && <div className="sf-tp-seg" role="group" aria-label="Scope">
          <button type="button" aria-pressed={scope === 'this'} onClick={() => setScope('this')} title={`Tests of ${agent}`}>This agent</button>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All agents</button>
        </div>}
        <button type="button" className="sf-tp-btn sf-ot-toggle" aria-pressed={hasRuns} onClick={() => setHasRuns(on => !on)}>Has runs</button>
        <button type="button" className="sf-tp-btn sf-ot-icon" aria-label="Refresh" title="Refresh tests" onClick={() => { void loadList(true); void loadLocal(); void loadRuns(); }}>↻</button>
        <div className="sf-ot-menu">
          <button type="button" className="sf-tp-btn sf-ot-icon" aria-label="More actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>⋯</button>
          {menuOpen && <div className="sf-ot-pop" role="dialog" aria-label="Attach a run" onKeyDown={e => { if (e.key === 'Escape') setMenuOpen(false); }}>
            <label>Attach run by id<input autoFocus value={attachId} onChange={e => setAttachId(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') attachRun(); }} placeholder="Run id from Testing Center or CI" /></label>
            <span className="sf-tp-sub">Adds a run started in Testing Center or CI to the history.</span>
            <div className="sf-tp-bar"><span className="sf-tp-spacer" /><button type="button" className="sf-tp-btn is-primary" disabled={working} onClick={attachRun}>Attach</button></div>
          </div>}
        </div>
      </div>
      <div className="sf-ot-notices">
        {listError && <div className="sf-tp-message is-error" role="alert">{listError}</div>}
        {notice && <div className={`sf-tp-message is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          {notice.allowReads && <button type="button" className="sf-tp-btn" disabled={working} onClick={() => void allowReads()}>Allow reads…</button>}
        </div>}
      </div>
      <div className="sf-ot-body">
        <div className="sf-ot-side">
          <div className="sf-ot-list" data-testid="org-tests-table">
            {localEnabled && <section aria-label="Local cases" data-testid="local-tests-list">
              <h3 className="sf-ot-source">Local cases · Project</h3>
              {localError && <p className="sf-tp-message is-error" role="alert">{localError}</p>}
              {!localSuites && <p className="sf-ot-source">Loading local cases…</p>}
              {localSuites && !localMatching.length && <p className="sf-ot-source">{filtered ? 'No local cases match.' : scoped ? `No local cases for ${agent} yet.` : 'No local cases in this project yet.'}</p>}
              <ul className="sf-ot-rows sf-ot-flat">{localMatching.map(suite => <li key={suite.path} className="sf-ot-row" data-testid={`local-suite-${suite.id}`} aria-selected={selectedLocal === suite.path}>
                <button type="button" className="sf-ot-link" aria-pressed={selectedLocal === suite.path} onClick={() => selectLocal(suite)}>{suite.id}</button>
                <span className="sf-ot-rowsub"><span>{plural(suite.cases.length, 'case')}</span><span className="sf-ot-api">{suite.path}</span></span>
                <span className="sf-ot-right"><span className="sf-ot-chip">{suite.progress ? 'Running…' : suite.lastEval || suite.cases.some(c => suite.lastResults?.[c.id]) ? 'Has runs' : 'No runs'}</span></span>
              </li>)}</ul>
            </section>}
            {localEnabled && <h3 className="sf-ot-source">Org tests · {org?.alias ?? 'Salesforce'}</h3>}
            {!defs && <div className="sf-ot-blank"><p>Loading org tests…</p></div>}
            {scoped && <div className="sf-ot-scope" data-testid="org-tests-scope">
              <strong>{agent}</strong><span className="sf-tp-sub">· {withRunsText(mine, plural(mine.length, 'test'))}</span>
            </div>}
            {blank}
            {scoped && mine.length > 0 && <ul className="sf-ot-rows sf-ot-flat" aria-label={`Org tests for ${agent}`}>{mine.map(row)}</ul>}
            {scoped && others > 0 && <div className="sf-ot-more">
              {plural(others, 'more test')} for other agents. <button type="button" className="sf-ot-textbtn" onClick={() => setScope('all')}>Show all agents</button>
            </div>}
            {groups.map((group, index) => {
              const open = groupOpen(group.key, index);
              return <section key={group.key} className="sf-ot-group" data-testid={`org-tests-group-${group.key}`}>
                <button type="button" className="sf-ot-ghead" aria-expanded={open} onClick={() => setExpanded(state => ({ ...state, [group.key]: !open }))}>
                  <span className="sf-ot-chev" aria-hidden="true">▼</span>
                  <span>{group.label}</span>
                  {agent && group.key === agent.toLowerCase() && <span className="sf-ot-badge">open in Studio</span>}
                  <span className="sf-ot-count">{group.state === 'agent' ? withRunsText(group.defs, plural(group.defs.length, 'test')) : plural(group.defs.length, 'test')}</span>
                </button>
                {open && <ul className="sf-ot-rows" aria-label={group.label}>{group.defs.map(row)}</ul>}
              </section>;
            })}
          </div>
          {defs && <div className="sf-ot-foot" aria-live="polite">
            <span>{localEnabled ? `${localMatching.length} of ${plural(localAll.length, 'local suite')} · ${shown.length} of ${plural(all.length, 'org test')}` : `${shown.length} of ${plural(all.length, 'test')}`}</span>
            {progress && progress.done < progress.total && <>
              <span className="sf-tp-spacer" />
              <span>Reading definitions {progress.done}/{progress.total}</span>
              <span className="sf-ot-prog" role="progressbar" aria-label="Reading definitions" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
              </span>
            </>}
            {progress && progress.done >= progress.total && progress.unread > 0 && <><span className="sf-tp-spacer" /><span title="Their agent is unknown; select one to read it.">{progress.unread} could not be read</span></>}
          </div>}
        </div>

        <div className="sf-ot-detail">
          {local && props.renderLocalSuite?.(local)}
          {!local && !selected && !run && <div className="sf-ot-empty">{localEnabled ? 'Pick local cases or an org test to see its cases and runs.' : 'Pick a test to see its cases and runs.'}</div>}
          {!selected && run && <OrgRunDetail run={run} previous={previous} path={path} busy={working}
            onImport={cases => importCases(run.definition, undefined, cases, 'import-run')} onAskAgent={onAskAgent} />}
          {selected && <section className="sf-ot-run" aria-label={`Test ${selected}`} data-testid="org-def-detail">
            <div className="sf-ot-dhead">
              <div>
                <h3>{definition?.label || selectedDef?.label || selected}</h3>
                <span className="sf-ot-api sf-tp-sub">{selected}</span>
              </div>
              <span className="sf-tp-spacer" />
              {active && <button type="button" className="sf-tp-btn" disabled={working} onClick={() => void cancelRun()}>Cancel run</button>}
              <button type="button" className="sf-tp-btn is-primary" disabled={working || Boolean(active)} onClick={() => setConfirming(true)}>{busy === 'start' || busy === 'reads' ? 'Starting…' : 'Run in org'}</button>
            </div>
            {confirming && <div className="sf-ot-confirm" role="group" aria-label="Confirm run">
              <span>Run {selected} in {org?.alias ?? 'the org'}? This uses org evaluation resources.</span>
              <button type="button" className="sf-tp-btn is-primary" onClick={confirmRun}>Start run</button>
              <button type="button" className="sf-tp-btn" onClick={() => setConfirming(false)}>Not now</button>
            </div>}
            <dl className="sf-ot-meta">
              <div><dt>Agent</dt><dd>{definition?.subjectName ?? selectedDef?.subjectName ?? '—'}</dd></div>
              <div><dt>Cases</dt><dd>{definition ? `${definition.testCases.length}${definition.truncated ? '+' : ''}` : selectedDef?.caseCount ?? '—'}</dd></div>
              <div><dt>Last run</dt><dd>{lastRun ? `${percent(passRate(lastRun.counts))} · ${relativeTime(lastRun.startedAt)}` : 'Never'}</dd></div>
              <div><dt>Trend</dt><dd>{sparkSeries(history).length > 1 ? <Spark rates={sparkSeries(history)} /> : '—'}</dd></div>
            </dl>
            {!history.length && <div className="sf-tp-sub" data-testid="org-runs-note">
              Runs started in Testing Center aren't visible here. <button type="button" className="sf-ot-textbtn" onClick={() => setMenuOpen(true)}>Add one by run ID.</button>
            </div>}
            {history.length > 0 && <>
              <div className="sf-ot-sec">Recent runs</div>
              <div className="sf-ot-runs" role="group" aria-label="Run history">
                {history.slice(0, 8).map(r => <button key={r.runId} type="button" className="sf-ot-runcard" aria-pressed={runId === r.runId} title={r.runId}
                  aria-label={`${r.runId} · ${r.status.replace('_', ' ')} · ${percent(passRate(r.counts))} · ${relativeTime(r.startedAt)}`} onClick={() => void openRun(r.runId)}>
                  <strong>{isOrgRunTerminal(r.status) ? percent(passRate(r.counts)) : 'Running…'}</strong>
                  <small>{r.status.replace('_', ' ')} · {relativeTime(r.startedAt)}</small>
                </button>)}
              </div>
            </>}
            {run && <OrgRunDetail run={run} previous={previous} definitionCases={definition?.testCases} path={path} busy={working}
              onImport={cases => importCases(run.definition, definition?.label, cases, 'import-run')} onAskAgent={onAskAgent} />}
            <div className="sf-ot-dhead">
              <div className="sf-ot-sec">Cases{definition?.truncated ? ' (truncated)' : ''}</div>
              <span className="sf-tp-spacer" />
              <button type="button" className="sf-tp-btn" disabled={working || !definition?.testCases.length || !path}
                title={!path ? 'Open an agent file to import into its suite.' : 'Copy these cases into the agent\'s local test suite.'}
                onClick={() => definition && importCases(definition.name, definition.label, definition.testCases, 'import')}>Import to suite</button>
            </div>
            {!definition && <div className="sf-tp-empty">Reading the definition…</div>}
            {definition && !definition.testCases.length && <div className="sf-tp-empty">This definition has no cases.</div>}
            {definition && definition.testCases.length > 0 && <OrgCaseTable key={definition.name} cases={definition.testCases} run={run?.definition === definition.name ? run : null} />}
          </section>}
        </div>
      </div>
    </div>
  );
}
