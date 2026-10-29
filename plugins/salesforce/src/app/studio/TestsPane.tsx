import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { callPluginRpc, experimental_requestApproval, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type CaseOutcome, type CaseResult, type ScenarioCase, type ScenarioSuite } from '../../../lib/studio-contract.js';
import { parseExtraAssertions, actionCheckLabel, stateCheckLabel } from '../../../lib/scenario-assertions.js';
import { SuiteComparisonView } from './SuiteComparisonView.js';
import type { SuiteComparison } from '../../../lib/studio-contract.js';
import { TestCasesWorkbench, caseStatus, type CaseFilter } from './TestCasesWorkbench.js';
import { RELEASE_RPC, type ReleasePrepared } from '../../../lib/release-contract.js';
import { FIX_LOOP_LIMITS, type FixLoop } from '../../../lib/fix-loop.js';
import { declined, type Message } from './approval-notice.js';
import { OrgTestsView } from './OrgTestsView.js';
import { LocalSuiteDetail } from './LocalSuiteDetail.js';
import { runSuiteJob, SuiteStoppedError } from './suite-job-rpc.js';
import { SuiteRunProgress } from './SuiteRunProgress.js';
import { SimulationsView, type SimulationsFocus } from './SimulationsView.js';
import { CaseVariables } from './CaseVariables.js';
import { ScenariosView } from './ScenariosView.js';
import { useScenarioLibrary, type ScenarioLibraryControls, type ScenarioSelection } from './useScenarioLibrary.js';
import { sameContext } from '../../../lib/preview-context-preset-contract.js';

/**
 * The Tests tool: a scenario catalogue with a selected case inspector. Simulate runs the
 * editor source; Org eval runs the generated `sf agent test` spec against the
 * published agent; a proposal open in the editor can run without being stored.
 * "Make these pass" hands failing cases to the thread agent as a bounded fix loop.
 * Test catalogue, batch simulations and role-play share the same navigation.
 */
export interface TestsPaneProps {
  pluginId: string;
  projectId?: string;
  threadId?: string;
  path: string | null;
  /** The editor source. Simulate runs it, not the file on disk. */
  source: string;
  visible: boolean;
  dirty: boolean;
  /** The source of an edit an agent is proposing, while the proposal is open. */
  proposalSource?: string | null;
  /** The single-conversation AI role-play lab. */
  roleplay: ReactNode | ((library: ScenarioLibraryControls) => ReactNode);
  onAskAgent?(prompt: string): void;
  /** "Show path on graph": open the conversation map with this case pinned. */
  onShowPath?(caseId: string): void;
  /** Injected in tests. */
  call?: typeof callPluginRpc;
  requestApproval?: typeof experimental_requestApproval;
  /** Embed the local case table in the combined tests workbench. */
  casesOnly?: boolean;
  /** simulations.open: show the Simulations view, on this batch when named. */
  simulationsFocus?: SimulationsFocus | null;
  onSimulationsFocusHandled?(seq: number): void;
  /** Return to a running role-play from the Studio run tray. */
  roleplayFocus?: number;
}

type Suite = ScenarioSuite & { sha256?: string };
interface Detail extends CaseResult { caseId: string; turns: Array<{ role: 'user' | 'agent'; text: string }> }
type TestsView = 'scenarios' | 'cases' | 'org' | 'simulations' | 'roleplay';
type Notice = Message & { allowReads?: boolean };
type Reply = { ok?: boolean; code?: string; error?: string; summary?: string } & Record<string, unknown>;

const SPEC_BYTES = 256_000;

const STYLES = `
.sf-tp { container-type: inline-size; display: flex; flex-direction: column; gap: 10px; padding: 10px; box-sizing:border-box; color: var(--sf-text); font-size: 12px; min-height: 0; min-width:0; overflow: auto; flex: 1; }
.sf-tp[data-view] { overflow:hidden; }
.sf-tp > .sf-tp-head { flex-shrink:0; }
.sf-tp-subview { display:flex; flex-direction:column; flex:1; min-width:0; min-height:0; overflow:auto; overscroll-behavior:contain; }
.sf-tp-subview[hidden] { display:none; }
.sf-tp-subview.is-workbench { overflow:hidden; }
.sf-tp-cases-view { flex:1; display:flex; flex-direction:column; gap:10px; min-height:0; overflow:hidden; }
.sf-tp-cases-view[hidden] { display:none; }
.sf-tp-cases-view > :not(.sf-tp-cases-scroll) { flex-shrink:0; }
.sf-tp-cases-scroll { flex:1; display:flex; flex-direction:column; min-height:0; min-width:0; overflow:hidden; overscroll-behavior:contain; }
.sf-tp-cases-scroll > :not(.sf-cases) { flex-shrink:0; max-height:45%; overflow:auto; margin-bottom:10px; }
.sf-tp-cases-scroll .sf-tp-table thead { position:sticky; top:0; z-index:1; background:var(--sf-bg); }
.sf-tp-cases-scroll:focus-visible { outline:2px solid var(--sf-accent); outline-offset:-2px; }
.sf-tp-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sf-tp-head h2 { margin: 0; font-size: 13px; }
.sf-tp-seg { display: inline-flex; max-width:100%; border: 1px solid var(--sf-border); border-radius: 6px; overflow-x:auto; }
.sf-tp-seg button { flex-shrink:0; border: 0; background: transparent; color: var(--sf-muted); padding: 3px 10px; min-height:30px; font: inherit; cursor: pointer; }
.sf-tp-seg button[aria-pressed="true"] { background: var(--sf-soft); color: var(--sf-text); }
.sf-tp-spacer { flex: 1; }
.sf-tp-bar { display: flex; gap: 6px; flex-wrap: wrap; }
.sf-tp-btn { border: 1px solid var(--sf-border); background: transparent; color: var(--sf-text); border-radius: 6px; padding: 3px 10px; font: inherit; cursor: pointer; white-space: nowrap; }
.sf-tp-btn.is-primary { border-color: var(--sf-accent); color: var(--sf-accent); }
.sf-tp-btn.is-danger { border-color: var(--sf-danger); color: var(--sf-danger); }
.sf-tp-btn.is-danger:hover { background: color-mix(in srgb, var(--sf-danger) 10%, transparent); }
.sf-tp-btn:disabled { opacity: 0.5; cursor: default; }
.sf-tp-table { width: 100%; border-collapse: collapse; }
.sf-tp-table th { text-align: left; font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--sf-muted); padding: 4px 6px; border-bottom: 1px solid var(--sf-border); }
.sf-tp-table td { padding: 6px; border-bottom: 1px solid var(--sf-border); vertical-align: top; }
.sf-tp-row { cursor: pointer; }
.sf-tp-row:hover td { background: var(--sf-soft); }
.sf-tp-name { font-weight: 600; }
.sf-tp-case-toggle { display:inline-flex; align-items:center; gap:6px; min-height:30px; max-width:100%; padding:4px 6px; white-space:normal; text-align:left; color:var(--sf-accent); }
.sf-tp-case-toggle:focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
.sf-tp-case-chevron { display:inline-block; flex:none; width:12px; font-size:14px; transition:transform .12s; }
.sf-tp-case-toggle[aria-expanded="true"] .sf-tp-case-chevron { transform:rotate(90deg); }
.sf-tp-sub { color: var(--sf-muted); overflow-wrap: anywhere; }
.sf-tp-chip { border-radius: 999px; padding: 0 6px; border: 1px solid var(--sf-border); color: var(--sf-muted); font-size: 11px; white-space: nowrap; }
.sf-tp-chip.is-pass { border-color: var(--sf-success); color: var(--sf-success); }
.sf-tp-chip.is-fail { border-color: var(--sf-danger); color: var(--sf-danger); }
.sf-tp-chip.is-pinned { border-color: var(--sf-accent); color: var(--sf-accent); margin-left: 6px; }
.sf-tp-detail { background: var(--sf-elevated); }
.sf-tp-compare { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
@container (max-width: 600px) { .sf-tp-compare { grid-template-columns: minmax(0, 1fr); } }
.sf-tp-compare h4 { margin: 0 0 4px; font-size: 11px; color: var(--sf-muted); }
.sf-tp-compare ul { margin: 0; padding-left: 16px; }
.sf-tp-turn { margin: 0 0 4px; white-space: pre-wrap; }
.sf-tp-message { border-radius: 6px; padding: 6px 8px; background: var(--sf-elevated); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.sf-tp-message.is-error { color: var(--sf-danger); }
.sf-tp-message.is-muted { color: var(--sf-muted); }
.sf-tp-loop { border: 1px solid var(--sf-accent); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.sf-tp-loop ol { margin: 0; padding-left: 18px; }
.sf-tp-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px; }
.sf-tp-form label { display: flex; flex-direction: column; gap: 2px; color: var(--sf-muted); }
.sf-tp-form .is-wide { grid-column: 1 / -1; }
.sf-tp-form fieldset { min-width: 0; margin: 0; }
.sf-tp-form input, .sf-tp-form textarea { min-width: 0; max-width: 100%; box-sizing: border-box; font: inherit; color: var(--sf-text); background: var(--sf-sunken); border: 1px solid var(--sf-border); border-radius: 6px; padding: 3px 6px; }
.sf-tp-foot { color: var(--sf-muted); margin: 0; }
.sf-tp-empty { color: var(--sf-muted); padding: 4px 2px; }
.sf-tp-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--sf-border); border-radius: 8px; }
.sf-tp-score { font-size: 18px; font-weight: 700; }
.sf-tp-passbar { width: 140px; height: 7px; border-radius: 4px; background: var(--sf-soft); overflow: hidden; display: flex; }
.sf-tp-passbar i { display: block; height: 100%; }
.sf-tp-passbar .is-pass { background: var(--sf-success); }
.sf-tp-passbar .is-fail { background: var(--sf-danger); }
.sf-tp-checks { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.sf-tp-check { border-radius: 999px; padding: 0 6px; border: 1px solid var(--sf-border); font-size: 11px; white-space: nowrap; font-family: var(--sf-mono, ui-monospace, monospace); }
.sf-tp-check.is-ok { border-color: var(--sf-success); color: var(--sf-success); }
.sf-tp-check.is-ko { border-color: var(--sf-danger); color: var(--sf-danger); }
.sf-tp-rubric { color: var(--sf-text); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.sf-tp-rubric.is-open { -webkit-line-clamp: unset; }
.sf-tp-more { border: 0; background: none; padding: 0; color: var(--sf-accent); font: inherit; font-size: 11px; cursor: pointer; }
.sf-tp-na { color: var(--sf-muted); font-size: 11px; }
.sf-tp-list { display: flex; flex-direction: column; }
.sf-tp-line { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; border-bottom: 1px dashed var(--sf-border); overflow-wrap: anywhere; }
.sf-tp-line:last-child { border-bottom: 0; }
.sf-tp-mark { flex: none; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; font-size: 10px; color: #fff; background: var(--sf-muted); }
.sf-tp-mark.is-ok { background: var(--sf-success); }
.sf-tp-mark.is-ko { background: var(--sf-danger); }
.sf-tp-mark.is-expect { background: transparent; color: var(--sf-muted); border: 1px solid var(--sf-border); }
.sf-tp-why { margin-top: 8px; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--sf-danger); background: color-mix(in srgb, var(--sf-danger) 10%, transparent); overflow-wrap: anywhere; }
.sf-tp-why strong { color: var(--sf-danger); }
.sf-tp-reply { margin: 6px 0 0; color: var(--sf-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.sf-tp-detail .sf-tp-bar { margin-top: 8px; }
.sf-tp-run { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--sf-accent); border-radius: 8px; }
.sf-tp-run progress { flex: 1; min-width: 80px; accent-color: var(--sf-accent); }
.sf-tp-run-case { font-weight: 600; overflow-wrap: anywhere; }
.sf-tp-chip.is-running { color: var(--sf-accent); border-color: var(--sf-accent); }
@container (max-width: 480px) { .sf-tp-form { grid-template-columns: minmax(0, 1fr); } .sf-tp-table { table-layout: fixed; } .sf-tp-table td, .sf-tp-table th { overflow-wrap: anywhere; } .sf-tp-chip,.sf-tp-check { white-space: normal; overflow-wrap:anywhere; } .sf-tp-head>.sf-tp-seg { flex-basis:100%; } .sf-tp-head>.sf-tp-sub { min-width:0; flex:1 1 160px; } .sf-tp-bar>.sf-tp-btn { min-height:32px; white-space:normal; } }
`;
/** Shared by the Org tests editor tab, which reuses the pane's tables, chips and buttons. */
export const TESTS_PANE_STYLES = STYLES;

/** "just now", "5 min ago", "3 h ago", else a short date. */
export function relativeTime(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return shortDate(at);
}

/** Pass and fail counts of the cases that have a Simulate result, and when the newest ran. */
export function runSummary(cases: readonly ScenarioCase[], results: ScenarioSuite['lastResults']): { pass: number; fail: number; ran: number; at: number } {
  let pass = 0, fail = 0, ran = 0, at = 0;
  for (const c of cases) {
    const result = results?.[c.id];
    if (!result) continue;
    ran++; at = Math.max(at, result.at);
    if (result.outcome === 'pass') pass++; else if (result.outcome === 'fail') fail++;
  }
  return { pass, fail, ran, at };
}

/** The evidence to show for a case: this session's run when there is one, else the saved result. */
function evidenceOf(detail: Detail | undefined, saved: CaseResult | undefined): CaseResult | undefined {
  if (!detail) return saved;
  const reply = [...detail.turns].reverse().find(turn => turn.role === 'agent')?.text;
  return { outcome: detail.outcome, runId: saved?.runId ?? '', at: saved?.at ?? Date.now(), notes: detail.notes, ...(detail.deterministic || saved?.deterministic ? { deterministic: detail.deterministic ?? saved?.deterministic } : {}), ...(detail.setupBlocked ? { setupBlocked: true } : {}), ...(detail.stopped ? { stopped: true } : {}), ...(detail.turns.length ? { conversation: detail.turns.map(turn => ({ role: turn.role, message: turn.text })) } : saved?.conversation ? { conversation: saved.conversation } : {}), ...(saved?.conversationTruncated ? { conversationTruncated: true } : {}), ...(saved?.assertions ? { assertions: saved.assertions } : {}), ...(detail.observed ? { observed: detail.observed } : {}), ...(detail.judge ? { judge: detail.judge } : {}), ...(reply ? { reply } : {}) };
}

const shortDate = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** What a case checks, one line per kind. */
export function expectLines(expect: ScenarioCase['expect']): string[] {
  return [
    ...(expect.topic ? [`Topic ${expect.topic}`] : []),
    ...(expect.actions?.length ? [`Calls ${expect.actions.join(', ')}`] : []),
    ...(expect.contains?.length ? [`Mentions ${expect.contains.map(text => `"${text}"`).join(', ')}`] : []),
    ...(expect.maxLatencyMs !== undefined ? [`Each response ≤ ${expect.maxLatencyMs} ms`] : []),
    ...(expect.actionChecks?.map(actionCheckLabel) ?? []),
    ...(expect.stateChecks?.map(stateCheckLabel) ?? []),
    ...(expect.criteria ? [expect.criteria] : [])
  ];
}

const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
function uniqueId(name: string, taken: Set<string>): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'case';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** The thread agent's instructions for one fix loop. */
export function fixLoopPrompt(loop: Pick<FixLoop, 'id' | 'budget' | 'caseIds'>, path: string, cases: ScenarioCase[]): string {
  const names = loop.caseIds.map(id => { const c = cases.find(row => row.id === id); return c ? `"${c.name}" (${id})` : id; });
  return [
    `Make these failing Agentforce test cases pass: ${names.join(', ')}.`,
    `This is fix loop ${loop.id}. You have ${loop.budget} Simulate runs and may only change ${path}.`,
    `For each attempt, call sf_workbench with action suites.run and input { "loopId": "${loop.id}", "agentPath": "${path}", "source": <the full candidate source> }, poll suites.result with the returned jobId until completed, then follow result.next. Use a stable requestId for each attempt so retries never spend another attempt.`,
    'Stop when every case passes or no attempts are left. Then propose your best candidate with ui.command editor.proposeEdit and say which cases still fail.',
    'Do not save, publish or activate anything.'
  ].join('\n');
}

export function TestsPane(props: TestsPaneProps) {
  const { pluginId, projectId, threadId, path, source, visible, dirty, proposalSource, roleplay, onAskAgent, onShowPath } = props;
  const call = props.call ?? callPluginRpc;
  const requestApproval = props.requestApproval ?? experimental_requestApproval;
  const [view, setView] = useState<TestsView>('cases');
  const [roleplayShown, setRoleplayShown] = useState(false);
  const [simulationsShown, setSimulationsShown] = useState(false);
  const [orgShown, setOrgShown] = useState(false);
  const [scenariosShown, setScenariosShown] = useState(false);
  const library = useScenarioLibrary({ pluginId, projectId, path, call, enabled: !props.casesOnly });
  const [roleplayScenario, setRoleplayScenario] = useState<ScenarioSelection>();
  const [batchScenario, setBatchScenario] = useState<ScenarioSelection>();
  const scenarioSequence = useRef(0);
  useEffect(() => { setRoleplayScenario(undefined); setBatchScenario(undefined); }, [pluginId, projectId, path]);
  const [suite, setSuite] = useState<Suite | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [proposal, setProposal] = useState<Record<string, CaseOutcome>>({});
  const [loop, setLoop] = useState<FixLoop | null>(null);
  const [activeJob, setActiveJob] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<string[]>([]);
  const jobController = useRef(new AbortController());
  useEffect(() => {
    jobController.current = new AbortController();
    setPrepared([]); setActiveJob(null);
    return () => jobController.current.abort();
  }, [path, projectId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [adding, setAdding] = useState(false);
  const [comparison, setComparison] = useState<{ value: SuiteComparison; source: string; cases: string } | null>(null);
  const comparisonTarget = useRef('');
  comparisonTarget.current = JSON.stringify([projectId, path]);
  const [filter, setFilter] = useState<CaseFilter>('all');
  const fileInput = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const rpc = useCallback(async (method: string, args: Record<string, unknown> = {}): Promise<Reply> => {
    const reply = await call(pluginId, method, { ...(projectId ? { projectId } : {}), ...(path ? { agentPath: path } : {}), ...args }) as Reply | null;
    return reply ?? { ok: false, error: 'No response.' };
  }, [call, path, pluginId, projectId]);

  const load = useCallback(async () => {
    const seq = ++sequence.current;
    if (!path) { setSuite(null); setLoop(null); setLoaded(true); return; }
    try {
      const [listed, latest] = await Promise.all([rpc(STUDIO_RPC.suites), rpc(STUDIO_RPC.loopGet)]);
      if (!alive.current || seq !== sequence.current) return;
      if (listed.ok !== false && Array.isArray(listed.suites)) setSuite((listed.suites as Suite[])[0] ?? null);
      else setNotice({ tone: 'error', text: listed.error || 'Could not read the scenario suite.' });
      if (listed.ok !== false) setActiveJob((listed.job as { jobId?: string } | null)?.jobId ?? null);
      if (latest.ok !== false) setLoop((latest.loop as FixLoop | null) ?? null);
    } catch (error) {
      if (alive.current && seq === sequence.current) setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (alive.current && seq === sequence.current) setLoaded(true);
    }
  }, [path, rpc]);

  useEffect(() => { setBusy(null); setSuite(null); setLoop(null); setDetails({}); setProposal({}); setComparison(null); setNotice(null); setAdding(false); setFilter('all'); setLoaded(false); }, [path, projectId]);
  useEffect(() => { setProposal({}); }, [proposalSource]);
  useEffect(() => { if (visible) void load(); }, [visible, load]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const row = payload as { kind?: string; projectId?: string; path?: string; loopId?: string } | null;
    if (!row || (row.projectId && row.projectId !== projectId)) return;
    if ((row.kind === 'suites' || (row.kind === 'suite-progress' && row.path === suite?.path)) && visible) void load();
    if (row.kind === 'loop' && row.path === path && row.loopId) {
      void rpc(STUDIO_RPC.loopGet, { loopId: row.loopId }).then(reply => {
        if (alive.current && reply.ok !== false && reply.loop) setLoop(reply.loop as FixLoop);
      }).catch(() => undefined);
    }
  });
  // Reconcile after missed realtime messages, and recover a run when reopening Tests.
  const hasRun = Boolean(activeJob || suite?.progress || busy === 'simulate' || busy === 'proposal' || busy === 'compare' || busy === 'eval' || busy === 'reads' || busy?.startsWith('case:'));
  useEffect(() => {
    if (!visible || !hasRun) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [visible, hasRun, load]);

  /** Runs one step with the busy flag and an error notice; the step returns the notice to show, if any. */
  const perform = useCallback(async (key: string, work: () => Promise<Notice | null>) => {
    const target = comparisonTarget.current;
    setBusy(key);
    setStartedAt(Date.now());
    setNotice(null);
    try {
      const next = await work();
      if (alive.current && target === comparisonTarget.current && next) setNotice(next);
    } catch (error) {
      if (alive.current && target === comparisonTarget.current) setNotice({ tone: error instanceof SuiteStoppedError ? 'muted' : 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      if (alive.current && target === comparisonTarget.current) setBusy(null);
    }
  }, []);

  const background = (args: Record<string, unknown>) => runSuiteJob(rpc, { ...args, preparedCaseIds: prepared }, jobController.current.signal, id => { if (alive.current) setActiveJob(id); });

  const simulate = (caseIds?: string[]) => perform(caseIds ? `case:${caseIds[0]}` : 'simulate', async () => {
    setDetails({});
    const reply = await background({ path: suite?.path, source, engine: 'preview', startedByUser: true, ...(threadId ? { threadId } : {}), ...(caseIds ? { caseIds } : {}) });
    if (reply.ok === false || !reply.suite) return { tone: 'error', text: reply.error || 'The suite could not run.' };
    if (!alive.current) return null;
    setSuite(current => ({ ...(reply.suite as Suite), sha256: current?.sha256 ?? (reply.suite as Suite).sha256 }));
    const rows = Array.isArray(reply.details) ? reply.details as Detail[] : [];
    setDetails(current => ({ ...current, ...Object.fromEntries(rows.map(row => [row.caseId, row])) }));
    return null;
  });

  const compare = () => perform('compare', async () => {
    const target = comparisonTarget.current;
    const snapshot = { source, cases: JSON.stringify(suite?.cases) };
    const reply = await background({ compare: true, source, startedByUser: true, ...(threadId ? { threadId } : {}) });
    if (!alive.current || target !== comparisonTarget.current) return null;
    if (reply.ok === false || !reply.comparison) return { tone: 'error', text: reply.error || 'The comparison could not run.' };
    setComparison({ value: reply.comparison as SuiteComparison, ...snapshot, cases: reply.suite ? JSON.stringify((reply.suite as ScenarioSuite).cases) : snapshot.cases });
    return null;
  });

  const runProposal = () => perform('proposal', async () => {
    const reply = await background({ path: suite?.path, source: proposalSource, engine: 'preview', store: false, startedByUser: true, ...(threadId ? { threadId } : {}) });
    if (reply.ok === false) return { tone: 'error', text: reply.error || 'The proposal could not run.' };
    const results = (reply.results ?? {}) as Record<string, { outcome: CaseOutcome }>;
    if (alive.current) setProposal(Object.fromEntries(Object.entries(results).map(([id, row]) => [id, row.outcome])));
    return { tone: 'muted', text: 'Ran the proposal in Simulate. Its results are not saved.' };
  });

  const evaluate = useCallback(async (): Promise<Notice | null> => {
    const reply = await rpc(STUDIO_RPC.suiteEval);
    if (reply.ok === false) {
      if (reply.code === 'refused') return { tone: 'error', text: 'This org is production or unknown. Running evals on it needs your approval.', allowReads: true };
      return { tone: 'error', text: reply.error || 'The org eval failed.' };
    }
    if (alive.current && reply.suite) setSuite(current => ({ ...(reply.suite as Suite), sha256: current?.sha256 ?? (reply.suite as Suite).sha256 }));
    return { tone: 'ok', text: reply.summary || 'Org eval finished.' };
  }, [rpc]);

  const allowReads = () => perform('reads', async () => {
    const prepared = await rpc(RELEASE_RPC.prepare, { path, action: 'org.read' }) as Reply & { data?: ReleasePrepared };
    if (prepared.ok === false && prepared.code !== 'not_needed') return { tone: 'error', text: prepared.error || 'Could not prepare the approval.' };
    if (prepared.ok !== false && prepared.data) {
      const answer = await requestApproval(pluginId, prepared.data.request);
      if (!answer.approved) return declined(answer.reason);
      const granted = await rpc(RELEASE_RPC.run, { path, action: 'org.read', token: answer.token });
      if (granted.ok === false) return { tone: 'error', text: granted.error || 'The approval was not accepted.' };
    }
    return evaluate();
  });

  const save = async (cases: ScenarioCase[]): Promise<Notice | null> => {
    const reply = await rpc(STUDIO_RPC.suiteSave, { cases, ...(suite?.sha256 ? { expectedSha256: suite.sha256 } : {}) });
    if (reply.ok === false || !reply.suite) return { tone: 'error', text: reply.error || 'The suite could not be saved.' };
    if (alive.current) setSuite(reply.suite as Suite);
    return null;
  };

  const addCase = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? '').trim();
    const name = field('name');
    const utterances = field('utterances').split('\n').map(line => line.trim()).filter(Boolean);
    if (!name || !utterances.length) { setNotice({ tone: 'error', text: 'A case needs a name and at least one utterance.' }); return; }
    let extras: ReturnType<typeof parseExtraAssertions>;
    try { extras = parseExtraAssertions({ ...(field('latency') ? { maxLatencyMs: Number(field('latency')) } : {}), ...(field('actionChecks') ? { actionChecks: JSON.parse(field('actionChecks')) } : {}), ...(field('stateChecks') ? { stateChecks: JSON.parse(field('stateChecks')) } : {}) }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : String(error) }); return; }
    const existing = suite?.cases ?? [];
    const next: ScenarioCase = {
      id: uniqueId(name, new Set(existing.map(c => c.id))), name, utterances,
      ...(field('prerequisites') ? { prerequisites: field('prerequisites').split('\n').map(s => s.trim()).filter(Boolean) } : {}),
      expect: {
        ...extras,
        ...(field('topic') ? { topic: field('topic') } : {}),
        ...(list(field('actions')).length ? { actions: list(field('actions')) } : {}),
        ...(list(field('forbiddenActions')).length ? { forbiddenActions: list(field('forbiddenActions')) } : {}),
        ...(list(field('contains')).length ? { contains: list(field('contains')) } : {}),
        ...(field('criteria') ? { criteria: field('criteria') } : {})
      }
    };
    void perform('add', async () => {
      const failed = await save([...existing, next]);
      if (!failed && alive.current) setAdding(false);
      return failed;
    });
  };

  const importFile = (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    if (file.size > SPEC_BYTES) { setNotice({ tone: 'error', text: 'The spec is larger than 256 KB.' }); return; }
    void perform('import', async () => {
      const reply = await rpc(STUDIO_RPC.suiteImport, { text: await file.text() });
      if (reply.ok === false || !reply.suite) return { tone: 'error', text: reply.error || 'The spec could not be imported.' };
      if (alive.current) setSuite(reply.suite as Suite);
      return { tone: 'ok', text: `Imported ${Number(reply.imported) || 0} case${reply.imported === 1 ? '' : 's'} from ${file.name}.` };
    });
  };

  const writeSpec = () => perform('spec', async () => {
    const reply = await rpc(STUDIO_RPC.suiteSpec);
    if (reply.ok === false) return { tone: 'error', text: reply.error || 'The eval spec could not be written.' };
    const multi = Array.isArray(reply.multiTurn) ? reply.multiTurn.length : 0;
    return { tone: 'ok', text: `Wrote ${String(reply.specPath)}.${multi ? ` ${multi} multi-turn case${multi === 1 ? ' replays its' : 's replay their'} final turn with recorded history; earlier replies are fixed context.` : ''}` };
  });

  const failing = suite ? suite.cases.filter(c => suite.lastResults?.[c.id]?.outcome === 'fail').map(c => c.id) : [];
  const startLoop = () => perform('loop', async () => {
    const reply = await rpc(STUDIO_RPC.loopStart, { caseIds: failing, budget: FIX_LOOP_LIMITS.budget });
    if (reply.ok === false || !reply.loop) return { tone: 'error', text: reply.error || 'The fix loop could not start.' };
    const started = reply.loop as FixLoop;
    if (!alive.current) return null;
    setLoop(started);
    onAskAgent?.(fixLoopPrompt(started, path ?? '', suite?.cases ?? []));
    return null;
  });
  const stopLoop = () => perform('stop', async () => {
    const reply = await rpc(STUDIO_RPC.loopStop, { loopId: loop?.id });
    if (reply.ok === false) return { tone: 'error', text: reply.error || 'The fix loop could not stop.' };
    if (alive.current && reply.loop) setLoop(reply.loop as FixLoop);
    return null;
  });

  const showView = (next: TestsView) => {
    setView(next);
    if (next === 'roleplay') setRoleplayShown(true);
    if (next === 'simulations') setSimulationsShown(true);
    if (next === 'org') setOrgShown(true);
    if (next === 'scenarios') setScenariosShown(true);
  };
  useEffect(() => { if (props.simulationsFocus && !props.casesOnly) { setView('simulations'); setSimulationsShown(true); } }, [props.simulationsFocus, props.casesOnly]);
  useEffect(() => { if (props.roleplayFocus !== undefined && !props.casesOnly) { setView('roleplay'); setRoleplayShown(true); } }, [props.roleplayFocus, props.casesOnly]);
  const switcher = props.casesOnly ? null : (
    <div className="sf-tp-seg" role="group" aria-label="Tests view">
      <button type="button" title="Create reusable customer setups and starting variables." aria-pressed={view === 'scenarios'} onClick={() => showView('scenarios')}>Scenarios</button>
      <button type="button" title="Replay saved scenarios and check expected outcomes for this agent." aria-pressed={view === 'cases'} onClick={() => showView('cases')}>Test cases</button>
      <button type="button" title="Run multiple AI customer conversations across scenarios and repeats." aria-pressed={view === 'simulations'} onClick={() => showView('simulations')}>Batch simulations</button>
      <button type="button" title="Explore one AI customer conversation with its setup, chat and traces." aria-pressed={view === 'roleplay'} onClick={() => showView('roleplay')}>Role-play</button>
    </div>
  );
  const browse = !props.casesOnly && <button className="sf-tp-btn" type="button" aria-pressed={view === 'org'} onClick={() => showView('org')}>Browse tests</button>;
  const controls: ScenarioLibraryControls = { ...library, onManage: () => showView('scenarios') };
  const scenariosView = scenariosShown && <div className="sf-tp-subview is-workbench" hidden={view !== 'scenarios'}>{path ? <ScenariosView key={JSON.stringify([pluginId, projectId, path])} library={controls} pluginId={pluginId} projectId={projectId} path={path} source={source} call={call}
    onRoleplay={scenario => { setRoleplayScenario({ scenario, seq: ++scenarioSequence.current }); showView('roleplay'); }}
    onBatch={scenario => { setBatchScenario({ scenario, seq: ++scenarioSequence.current }); showView('simulations'); }} /> : <p>Open an agent file to manage shared scenarios.</p>}</div>;
  const roleplayView = roleplayShown && <div className="sf-tp-subview is-workbench" hidden={view !== 'roleplay'}>{typeof roleplay === 'function' ? roleplay({ ...controls, selection: roleplayScenario }) : roleplay}</div>;
  const simulationsView = simulationsShown && <div className="sf-tp-subview" hidden={view !== 'simulations'}><SimulationsView pluginId={pluginId} projectId={projectId} threadId={threadId} path={path} source={source} dirty={dirty}
    visible={visible && view === 'simulations'} onAskAgent={onAskAgent} focus={props.simulationsFocus ?? null} onFocusHandled={props.onSimulationsFocusHandled} scenarioLibrary={{ ...controls, selection: batchScenario }} call={props.call} /></div>;
  const renderLocalSuite = (suite: ScenarioSuite) => <LocalSuiteDetail key={`${projectId}:${suite.path}`} suite={suite} editor={{ ...props, visible: visible && view === 'org' }} Cases={TestsPane} />;
  const orgView = orgShown && <div className="sf-tp-subview is-workbench" hidden={view !== 'org'}><OrgTestsView key={`${pluginId}:${projectId}:${path}`} pluginId={pluginId} projectId={projectId} threadId={threadId} path={path} visible={visible && view === 'org'} onAskAgent={onAskAgent} call={props.call} requestApproval={props.requestApproval} renderLocalSuite={renderLocalSuite} /></div>;

  if (!path) {
    return <section className="sf-tp" data-view={view} aria-label="Tests" data-testid="studio-tests-pane"><style>{STYLES}</style>
      <div className="sf-tp-head"><h2>Tests</h2><span className="sf-tp-spacer" />{switcher}{browse}</div>
      {view === 'cases' && <div className="sf-tp-empty">Open an agent file to test it.</div>}
      {scenariosView}
      {orgView}
      {simulationsView}
      {roleplayView}
    </section>;
  }

  const cases = suite?.cases ?? [];
  const showProposal = Boolean(proposalSource);
  const progress = suite?.progress;
  const running = busy !== null || Boolean(progress) || Boolean(activeJob);
  const loopLive = loop?.status === 'running';
  const summary = runSummary(cases, suite?.lastResults);
  const liveResults = progress && progress.mode === 'simulate' ? progress.results : undefined;
  const remaining = cases.filter(c => !suite?.lastResults?.[c.id]).map(c => c.id);
  const fixCase = (c: ScenarioCase) => {
    const notes = evidenceOf(details[c.id], suite?.lastResults?.[c.id])?.notes ?? [];
    onAskAgent?.([
      `Explain why the Agentforce test case "${c.name}" (${c.id}) fails in Simulate for ${path}, and fix it.`,
      `Utterances: ${c.utterances.join(' / ')}`,
      `Expected: ${expectLines(c.expect).join('; ') || 'nothing specific'}`,
      ...(notes.length ? [`Observed: ${notes.join('; ')}`] : []),
      'Propose changes with ui.command editor.proposeEdit. Do not save or publish.'
    ].join('\n'));
  };

  return (
    <section className="sf-tp" data-view={view} aria-label="Tests" data-testid="studio-tests-pane">
      <style>{STYLES}</style>
      <div className="sf-tp-head">
        <h2>Tests</h2>
        {suite && <span className="sf-tp-sub">{suite.path} · {cases.length} case{cases.length === 1 ? '' : 's'}</span>}
        <span className="sf-tp-spacer" />
        {switcher}{browse}
      </div>
      <div className="sf-tp-cases-view" hidden={view !== 'cases'}>
        {summary.ran > 0 && <div className="sf-tp-summary" data-testid="tests-summary">
          <span className="sf-tp-score" aria-label={`${summary.pass} of ${summary.ran} pass`}>{summary.pass}/{summary.ran}</span>
          <span className="sf-tp-passbar" aria-hidden="true"><i className="is-pass" style={{ width: `${(summary.pass / summary.ran) * 100}%` }} /><i className="is-fail" style={{ width: `${(summary.fail / summary.ran) * 100}%` }} /></span>
          <span className="sf-tp-chip">{hasRun ? 'Previous Simulate results' : 'Simulate'}</span>
          <span className="sf-tp-sub">{summary.pass} passed · {summary.fail} failed · {cases.filter(c => caseStatus(suite?.lastResults?.[c.id]) === 'stopped').length} stopped · {remaining.length} not run · {relativeTime(summary.at)}</span>
          <span className="sf-tp-spacer" />
          <div className="sf-tp-seg" role="group" aria-label="Filter cases">
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All {cases.length}</button>
            <button type="button" aria-pressed={filter === 'fail'} onClick={() => setFilter('fail')}>Failing {summary.fail}</button>
            <button type="button" aria-pressed={filter === 'pass'} onClick={() => setFilter('pass')}>Passing {summary.pass}</button>
          </div>
        </div>}
        <div className="sf-tp-bar" role="toolbar" aria-label="Test actions">
          <button type="button" className="sf-tp-btn is-primary" disabled={running || !cases.length || !source.trim()} onClick={() => void simulate()}>{busy === 'simulate' ? 'Running…' : 'Run all in Simulate'}</button>
          {!running && remaining.length > 0 && remaining.length < cases.length && <button type="button" className="sf-tp-btn" disabled={!source.trim()} onClick={() => void simulate(remaining)}>Run remaining {remaining.length}</button>}
          {activeJob && <button type="button" className="sf-tp-btn is-danger" onClick={() => void rpc(STUDIO_RPC.suiteStop, { jobId: activeJob }).then(() => load())}>Stop suite</button>}
          <button type="button" className="sf-tp-btn" disabled={running || !cases.length || !source.trim()} title="Run the saved source and editor draft on the same cases. Results do not replace ordinary suite results." onClick={() => void compare()}>{busy === 'compare' ? 'Comparing…' : 'Compare saved vs draft'}</button>
          <button type="button" className="sf-tp-btn" disabled={running || !cases.length} onClick={() => void perform('eval', evaluate)}>{busy === 'eval' || busy === 'reads' ? 'Running org eval…' : 'Run org eval'}</button>
          {showProposal && <button type="button" className="sf-tp-btn" disabled={running || !cases.length} onClick={() => void runProposal()}>{busy === 'proposal' ? 'Running…' : 'Run with proposal'}</button>}
          <button type="button" className="sf-tp-btn" disabled={running} aria-expanded={adding} onClick={() => setAdding(open => !open)}>+ Case</button>
          <button type="button" className="sf-tp-btn" disabled={running} onClick={() => fileInput.current?.click()}>{busy === 'import' ? 'Importing…' : 'Import YAML / JSON'}</button>
          <input ref={fileInput} type="file" accept=".yaml,.yml,.json" hidden aria-label="Import test spec" data-testid="tests-import-input" onChange={event => importFile(event.currentTarget.files?.[0])} />
          <button type="button" className="sf-tp-btn" disabled={running || !cases.length} onClick={() => void writeSpec()}>Write eval spec</button>
          <span className="sf-tp-spacer" />
          {onAskAgent && <button type="button" className="sf-tp-btn" disabled={running || loopLive || !failing.length || dirty}
            title={dirty ? 'Save first: the agent starts from the file on disk.' : !failing.length ? 'Run in Simulate first; the fix loop takes the failing cases.' : undefined}
            onClick={() => void startLoop()}>{failing.length ? `Make ${failing.length === 1 ? 'this' : 'these'} pass` : 'Make these pass'}</button>}
        </div>
        {hasRun && <SuiteRunProgress progress={progress} cases={busy?.startsWith('case:') ? cases.filter(c => busy === `case:${c.id}`) : cases} startedAt={startedAt} orgEval={busy === 'eval' || busy === 'reads'} />}
        {notice && <div className={`sf-tp-message is-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          {notice.allowReads && <button type="button" className="sf-tp-btn" disabled={running} onClick={() => void allowReads()}>Allow reads…</button>}
        </div>}
        <div className="sf-tp-cases-scroll">
        {comparison && <SuiteComparisonView comparison={comparison.value} cases={cases} stale={comparison.source !== source || comparison.cases !== JSON.stringify(suite?.cases)} />}
        {adding && <form className="sf-tp-form" aria-label="New test case" onSubmit={addCase}>
          <label>Name<input name="name" required maxLength={200} /></label>
          <label>Expected topic<input name="topic" maxLength={200} /></label>
          <label className="is-wide">Utterances, one per line<textarea name="utterances" rows={2} required /></label>
          <label>Expected actions, comma separated<input name="actions" /></label>
          <label>Forbidden actions, comma separated (use * for all)<input name="forbiddenActions" /></label>
          <label className="is-wide">Setup prerequisites, one per line<textarea name="prerequisites" rows={2} maxLength={5000} placeholder="Account context, saved address form, completed document generation…" /></label>
          <label>Reply mentions, comma separated<input name="contains" /></label>
          <label>Maximum response latency (ms)<input name="latency" type="number" min={1} max={300000} /></label>
          <label className="is-wide">Action field checks (JSON)<textarea name="actionChecks" rows={2} maxLength={8000} placeholder={'[{"action":"LookupOrder","side":"output","field":"status","operator":"equals","value":"Found"}]'} /></label>
          <label className="is-wide">Final state checks (JSON)<textarea name="stateChecks" rows={2} maxLength={8000} placeholder={'[{"variable":"orderExists","value":false}]'} /></label>
          <p className="is-wide sf-tp-foot">Action checks use equals, contains, less_than or greater_than. Missing or private evidence is Unclear. Latency and field checks run in Simulate.</p>
          <label className="is-wide">Criteria for the AI judge<input name="criteria" maxLength={4000} /></label>
          <div className="sf-tp-bar is-wide"><button type="submit" className="sf-tp-btn is-primary" disabled={running}>Add case</button>
            <button type="button" className="sf-tp-btn" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>}
        {loop && <div className="sf-tp-loop" data-testid="tests-loop" aria-label="Fix loop">
          <div className="sf-tp-head">
            <strong>Fix loop</strong>
            <span className="sf-tp-sub">{loop.status} · {loop.attempts.length} of {loop.budget} attempts · {loop.caseIds.length} case{loop.caseIds.length === 1 ? '' : 's'}</span>
            <span className="sf-tp-spacer" />
            {loopLive && <button type="button" className="sf-tp-btn" disabled={running} onClick={() => void stopLoop()}>Stop</button>}
          </div>
          {loop.attempts.length > 0 ? <ol>{loop.attempts.map(attempt => <li key={attempt.n}>
            {attempt.pass} of {attempt.total} pass{attempt.failing.length ? ` · still failing ${attempt.failing.join(', ')}` : ''}
          </li>)}</ol> : <span className="sf-tp-sub">Waiting for the agent's first run.</span>}
        </div>}
        {!loaded && !suite && <div className="sf-tp-empty">Loading cases…</div>}
        {loaded && !cases.length && <div className="sf-tp-empty">No cases yet. Add one, import a spec, or pin a conversation from Preview with Save as scenario.</div>}
        {cases.length > 0 && <TestCasesWorkbench key={`${projectId}:${path}`} cases={cases}
          results={Object.fromEntries(cases.map(c => [c.id, liveResults?.[c.id] ?? evidenceOf(details[c.id], suite?.lastResults?.[c.id])]))}
          progress={progress} lastEval={suite?.lastEval}
          proposal={showProposal ? progress?.mode === 'proposal' ? Object.fromEntries(Object.entries(progress.results).map(([id, result]) => [id, result.outcome])) : proposal : undefined}
          filter={filter} onFilterChange={setFilter} running={running} sourceReady={Boolean(source.trim())} prepared={prepared}
          onPreparedChange={(id, ready) => setPrepared(ids => ready ? [...ids, id] : ids.filter(value => value !== id))}
          onRun={id => void simulate([id])} onFix={onAskAgent ? fixCase : undefined} onShowPath={onShowPath}
          renderVariables={scenario => <CaseVariables key={scenario.id} scenario={scenario} path={path!} source={source} projectId={projectId} rpc={rpc} disabled={running} onSave={async (contextVariables, previous) => {
            if (!suite?.sha256) throw Error('Reload test cases before saving variable changes.');
            if (!sameContext(previous, scenario.contextVariables ?? [])) throw Error('This case has newer saved variables. Reload saved values before editing.');
            const target = comparisonTarget.current;
            setBusy('variables');
            try {
              const reply = await rpc(STUDIO_RPC.suiteSave, { cases: cases.map(c => c.id === scenario.id ? { ...c, contextVariables } : c), expectedSha256: suite.sha256 });
              if (reply.ok === false || !reply.suite) throw Error(reply.error || 'The case variables could not be saved.');
              if (alive.current && target === comparisonTarget.current) setSuite(reply.suite as Suite);
            } finally { if (alive.current && target === comparisonTarget.current) setBusy(null); }
          }} />}
          onRemove={id => void perform('remove', () => save(cases.filter(c => c.id !== id)))} />}
        <details className="sf-tp-foot"><summary>About Simulate and org eval</summary><p>Simulate runs the editor source{dirty ? ', including unsaved changes' : ''}. Org eval runs <code>sf agent test run-eval</code> against the agent published on the org. Multi-turn exports replay the final message with captured history; Simulate reruns all turns. A pass counts as Release eval evidence for the exported checks only.</p></details>
        </div>
      </div>
      {scenariosView}
      {orgView}
      {simulationsView}
      {roleplayView}
    </section>
  );
}
