import { useEffect, useId, useRef, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { DEFAULT_LAB_MODEL, LAB_SCENARIOS, parseLabScenario, type LabEngine, type LabScenario, type LabSnapshot, type LabTurn, type LabVerdict } from '../../lib/agentforce-lab-contract.js';
import { STUDIO_RESIZE_STYLES, useElementSize, useStudioSplit } from './studio/StudioResize.js';
import { Bot, FlaskConical } from './components/icons.js';
import { LoadingState } from './components/SalesforceState.js';
import { TracePanel } from './preview/TracePanel.js';
import { PREVIEW_CONTEXT_STYLES, PreviewContextEditor, usePreviewContext } from './preview/PreviewContext.js';
import { parsePreviewContext, type PreviewContextVariable } from '../../lib/preview-context.js';
import type { AppliedContextPreset } from '../../lib/preview-context-preset-contract.js';
import { caseFromRun, traceTopics } from './agentforce-preview-logic.js';
import { getStudioRun, runWorkspaceRef, studioRunKey, updateStudioRun, useRunWorkspaceState, type StudioRunOwner } from './studio/run-workspaces.js';
import { scenarioSnapshot, type SavedScenario } from '../../lib/scenario-library-contract.js';
import type { ScenarioLibraryControls } from './studio/useScenarioLibrary.js';
import { SaveSharedScenario } from './studio/SaveSharedScenario.js';
import { STUDIO_RPC, type ScenarioCase, type TurnTrace } from '../../lib/studio-contract.js';

/** One customer message and the agent replies to it. Exchange 0 holds a welcome sent before any customer message. */
export interface LabExchange { index: number; user?: { turn: LabTurn; at: number }; agents: Array<{ turn: LabTurn; at: number }> }

export function labExchanges(turns: readonly LabTurn[]): LabExchange[] {
  const rows: LabExchange[] = [];
  turns.forEach((turn, at) => {
    if (turn.role === 'user') rows.push({ index: rows.filter(row => row.index > 0).length + 1, user: { turn, at }, agents: [] });
    else {
      if (!rows.length) rows.push({ index: 0, agents: [] });
      rows[rows.length - 1]!.agents.push({ turn, at });
    }
  });
  return rows;
}

export type StepState = 'done' | 'cur' | 'todo';
/** Progress of a scripted run: a turn is done once the agent replied to it; the next one is current while the run is busy. */
export function labSteps(exchanges: readonly LabExchange[], planned: number, busy: boolean): StepState[] {
  const answered = new Set(exchanges.filter(row => row.index > 0 && row.agents.length).map(row => row.index));
  let current = busy;
  return Array.from({ length: planned }, (_, i) => {
    if (answered.has(i + 1)) return 'done';
    if (current) { current = false; return 'cur'; }
    return 'todo';
  });
}

/** Seconds since `since`, or '' under one second. */
export function elapsed(since: number, now: number): string {
  const seconds = Math.floor((now - since) / 1000);
  return seconds >= 1 ? `${seconds} s` : '';
}

const RAW_LIMIT = 200_000;

type AgentforceLabPanelProps = { pluginId: string; projectId?: string; threadId?: string; orgAlias?: string; source: string; mode: 'rehearse' | 'test'; fileLabel: string; hidden?: boolean; /** The .agent file; enables Save as test case. */ agentPath?: string; scenarioLibrary?: ScenarioLibraryControls };
export function AgentforceLabPanel(props: AgentforceLabPanelProps) {
  const owner: StudioRunOwner = { pluginId: props.pluginId, projectId: props.projectId, orgAlias: props.orgAlias, path: props.agentPath, view: 'roleplay' };
  return <AgentforceLabWorkspace key={studioRunKey(owner)} {...props} />;
}
function AgentforceLabWorkspace(props: AgentforceLabPanelProps) {
  const owner: StudioRunOwner = { pluginId: props.pluginId, projectId: props.projectId, orgAlias: props.orgAlias, path: props.agentPath, view: 'roleplay' };
  const workspaceKey = studioRunKey(owner);
  const split = useStudioSplit({ storageKey: `salesforce:studio:lab:${props.projectId ?? 'draft'}`, initial: 48, stack: false, breakpoint: 720 });
  const root = useRef<HTMLElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useElementSize(root, setBounds);
  const narrow = bounds.width > 0 && bounds.width < 1100;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<'conversation' | 'trace'>('conversation');
  const setup = useRef<HTMLElement>(null);
  const setupButton = useRef<HTMLButtonElement>(null);
  const setupWasOpen = useRef(false);
  const setupId = useId();
  const context = usePreviewContext({ pluginId: props.pluginId, projectId: props.projectId, source: props.source, path: props.agentPath, orgAlias: props.orgAlias, scope: `${props.projectId ?? ''}:${props.agentPath ?? ''}:${props.orgAlias ?? ''}` });
  const [engine, setEngine] = useRunWorkspaceState<LabEngine>(workspaceKey, 'engine', 'preview');
  const [model, setModel] = useRunWorkspaceState(workspaceKey, 'model', DEFAULT_LAB_MODEL);
  const [scenario, setScenario] = useRunWorkspaceState<LabScenario>(workspaceKey, 'scenario', { ...LAB_SCENARIOS[0].scenario });
  const [libraryInitialized, setLibraryInitialized] = useRunWorkspaceState(workspaceKey, 'libraryInitialized', false);
  const [presetName, setPresetName] = useRunWorkspaceState(workspaceKey, 'presetName', LAB_SCENARIOS[0].name);
  const [session, setSession] = useRunWorkspaceState<LabSnapshot | null>(workspaceKey, 'session', null);
  const [verdict, setVerdict] = useRunWorkspaceState<LabVerdict | null>(workspaceKey, 'verdict', null);
  const [draft, setDraft] = useRunWorkspaceState(workspaceKey, 'draft', '');
  const [busy, setBusy] = useRunWorkspaceState(workspaceKey, 'busy', false);
  const [status, setStatusText] = useRunWorkspaceState(workspaceKey, 'status', 'Ready when you are');
  const [phaseAt, setPhaseAt] = useRunWorkspaceState(workspaceKey, 'phaseAt', 0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useRunWorkspaceState(workspaceKey, 'error', '');
  const [runSource, setRunSource] = useRunWorkspaceState(workspaceKey, 'runSource', '');
  const [setupOpen, setSetupOpen] = useRunWorkspaceState(workspaceKey, 'setupOpen', true);
  const [traces, setTraces] = useRunWorkspaceState<Record<string, TurnTrace>>(workspaceKey, 'traces', {});
  const [evidenceView, setEvidenceView] = useRunWorkspaceState<'trace' | 'raw'>(workspaceKey, 'evidenceView', 'trace');
  const [selected, setSelected] = useRunWorkspaceState<number | null>(workspaceKey, 'selected', null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useRunWorkspaceState(workspaceKey, 'saved', '');
  /** The customer message in flight, shown before the agent's reply lands. */
  const [outgoing, setOutgoing] = useRunWorkspaceState<string | null>(workspaceKey, 'outgoing', null);
  const active = runWorkspaceRef<LabSnapshot | null>(workspaceKey, 'active', null, true);
  const locked = runWorkspaceRef(workspaceKey, 'locked', false);
  const epoch = runWorkspaceRef(workspaceKey, 'epoch', 0);
  const cancelled = runWorkspaceRef(workspaceKey, 'cancelled', false);
  const alive = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  const evidence = useRef<HTMLDivElement>(null);
  const requested = useRef(new Set<string>());
  const runDetails = runWorkspaceRef<{ source: string; file: string; scenario?: LabScenario; name?: string; contextVariables: PreviewContextVariable[]; contextPreset: AppliedContextPreset | null } | null>(workspaceKey, 'runDetails', null, true);

  const rpc = async <T,>(method: string, args: Record<string, unknown>): Promise<T> => {
    const result = await callPluginRpc(props.pluginId, `agentLab.${method}`, { projectId: props.projectId, ...args }) as { ok: boolean; data?: T; error?: string };
    if (!result?.ok || result.data === undefined) throw new Error(result?.error || 'The rehearsal could not complete.');
    return result.data;
  };
  const setStatus = (text: string) => { setStatusText(text); setPhaseAt(Date.now()); };
  const update = (value: LabSnapshot) => {
    active.current = value; setSession(value);
    updateStudioRun(owner, { runId: value.id, engine: value.live ? 'live' : value.engine === 'preview' ? 'simulate' : 'rehearse', status: value.closed || value.failed || value.execution && ['done', 'stopped', 'error'].includes(value.execution.phase) ? 'ended' : value.busy ? 'running' : 'active', turn: value.turns.filter(turn => turn.role === 'user').length });
    if (value.source) setRunSource(value.source);
    if (value.failed && !value.execution) { setBusy(false); setStatus('Run incomplete'); setError('This conversation could not continue. Start a new conversation to retry.'); }
    if (value.execution) {
      setBusy(Boolean(value.busy) && !value.closed && !['done', 'stopped', 'error'].includes(value.execution.phase)); setOutgoing(null);
      const execution = value.execution;
      if (execution.verdict) setVerdict(execution.verdict);
      if (execution.error) setError(execution.error);
      const labels = { opening: 'Starting role-play…', customer: `Turn ${execution.completedTurns + 1} of ${execution.totalTurns} · Customer thinking…`, agent: `Turn ${execution.completedTurns + 1} of ${execution.totalTurns} · Agent replying…`, evaluating: 'Evaluating the conversation…', done: 'Run complete', stopped: 'Stopped · partial conversation', error: 'Run incomplete' };
      setStatus(labels[execution.phase]);
      if (!runDetails.current && value.scenario) runDetails.current = { source: value.source ?? runSource, file: props.fileLabel, scenario: value.scenario, contextVariables: value.contextVariables ?? [], contextPreset: null };
    }
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let attached = true, pending = false;
    const refresh = async () => {
      if (pending || !active.current && locked.current) return;
      pending = true;
      const requestedEpoch = epoch.current;
      try {
        let current = active.current;
        if (!current) {
          const remembered = getStudioRun(owner);
          if (remembered && ['active', 'running'].includes(remembered.status)) {
            current = await rpc<LabSnapshot>('get', { id: remembered.runId, path: props.agentPath, orgAlias: props.orgAlias, includeSource: true });
          } else if (busy) {
            current = (await rpc<LabSnapshot[]>('list', { path: props.agentPath, orgAlias: props.orgAlias })).find(row => Boolean(row.execution) === (props.mode === 'test')) ?? null;
          }
        } else if (!current.closed && !(current.execution && ['done', 'stopped', 'error'].includes(current.execution.phase))) current = await rpc<LabSnapshot>('get', { id: current.id, path: props.agentPath, orgAlias: props.orgAlias, includeSource: true });
        if (!attached || epoch.current !== requestedEpoch) return;
        if (current) { update(current); if (!current.execution) setBusy(Boolean(current.busy) || locked.current); }
        else setBusy(false);
      } catch (err) { if (attached && epoch.current === requestedEpoch) {
        const message = err instanceof Error ? err.message : String(err);
        setBusy(false); setError(`Could not reconnect: ${message}`);
        if (message.startsWith('This run has expired')) {
          const remembered = getStudioRun(owner);
          if (remembered) updateStudioRun(owner, { runId: remembered.runId, engine: remembered.engine, status: 'expired', turn: remembered.turn });
          active.current = null; setSession(previous => previous ? { ...previous, closed: true } : previous); setStatus('Run unavailable');
        }
      } }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 1000);
    return () => { attached = false; clearInterval(timer); };
    // The keyed workspace captures the original project, file and org.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (selected === null && session?.turns.length) transcript.current?.scrollTo?.({ top: transcript.current.scrollHeight, behavior: 'smooth' });
  }, [session?.turns.length, outgoing, selected]);
  useEffect(() => {
    if (narrow && settingsOpen) setup.current?.querySelector<HTMLButtonElement>('button')?.focus();
    else if (setupWasOpen.current) setupButton.current?.focus();
    setupWasOpen.current = narrow && settingsOpen;
  }, [narrow, settingsOpen]);
  function closeSetup() { setSettingsOpen(false); }

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  // Each Preview reply's planner trace loads as soon as the reply lands, so the evidence column keeps pace with the chat.
  useEffect(() => {
    if (!session || session.engine !== 'preview') return;
    for (const turn of session.turns) {
      if (turn.role !== 'agent' || !turn.planId || requested.current.has(turn.planId)) continue;
      requested.current.add(turn.planId);
      void loadTrace(session.id, turn.planId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function perform(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    cancelled.current = false;
    setBusy(true); setError(''); setNow(Date.now());
    try { await work(); }
    catch (err) {
      if (!cancelled.current) { setError(err instanceof Error ? err.message : String(err)); setStatus('Run incomplete'); }
      if (active.current && !active.current.closed) {
        try { update(await rpc<LabSnapshot>('end', { id: active.current.id })); } catch { /* Original error stays visible. */ }
      }
    } finally { locked.current = false; setBusy(Boolean(active.current?.execution && active.current.busy)); }
  }
  async function begin(test: boolean) {
    epoch.current++;
    if (context.error) throw new Error(context.error);
    const contextVariables = parsePreviewContext(context.values);
    const contextPreset = context.presetIdentity;
    const selectedScenario = test ? parseLabScenario(scenario) : undefined;
    if (active.current && !active.current.closed) await rpc('end', { id: active.current.id });
    setVerdict(null); setSession(null); setOutgoing(null); setTraces({}); setSelected(null); setSaved(''); active.current = null; requested.current = new Set();
    if (selectedScenario) setSetupOpen(false);
    setSettingsOpen(false); setMobilePane('conversation');
    runDetails.current = { source: props.source, file: props.fileLabel, scenario: selectedScenario, contextVariables, contextPreset, ...(selectedScenario ? { name: presetName } : {}) };
    setRunSource(props.source);
    setStatus(engine === 'preview' ? 'Compiling draft in Salesforce…' : 'Preparing AI rehearsal…');
    const started = await rpc<LabSnapshot>(test ? 'run' : 'start', { engine, model, source: props.source, orgAlias: props.orgAlias, ...(props.agentPath ? { path: props.agentPath } : {}), ...(contextVariables.length ? { contextVariables } : {}), ...(props.threadId ? { threadId: props.threadId } : {}), ...(selectedScenario ? { scenario: selectedScenario } : {}) });
    update(started);
    if (cancelled.current) { update(await rpc<LabSnapshot>('end', { id: started.id })); return; }
    context.markApplied(contextVariables, contextPreset);
    if (!selectedScenario) setStatus('Conversation ready');
  }
  async function loadTrace(id: string, planId: string) {
    const unavailable = (reason: string): TurnTrace => ({ runId: id, turn: 0, planId, available: false, reason, steps: [] });
    const request = requested.current;
    try {
      const result = await callPluginRpc(props.pluginId, STUDIO_RPC.trace, { projectId: props.projectId, id, planId }) as { ok?: boolean; data?: TurnTrace; error?: string };
      const trace = result?.ok && result.data ? result.data : unavailable(result?.error || 'Trace request failed.');
      if (alive.current && request === requested.current) setTraces(prev => ({ ...prev, [planId]: trace }));
    } catch (err) { if (alive.current && request === requested.current) setTraces(prev => ({ ...prev, [planId]: unavailable(err instanceof Error ? err.message : String(err)) })); }
  }
  async function stop() {
    epoch.current++;
    cancelled.current = true;
    setStatus('Stopped · partial conversation'); setVerdict(null);
    if (active.current && !active.current.closed) {
      try { update(await rpc<LabSnapshot>('end', { id: active.current.id })); }
      catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    }
  }
  async function send() {
    const text = draft.trim();
    if (!text || !active.current || active.current.closed) return;
    setStatus('Agent replying…'); setOutgoing(text);
    try {
      const result = await rpc<LabSnapshot>('send', { id: active.current.id, text });
      if (cancelled.current) return;
      update(result); setDraft(''); setStatus('Your turn');
    } finally { setOutgoing(null); }
  }
  function exportRun() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...runDetails.current, session, traces, status, error: error || undefined, verdict, advisory: true }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'agentforce-rehearsal.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  /** Pins this conversation as a scenario case: its customer turns replay, the routing it showed becomes the expectation. */
  async function saveAsCase() {
    if (!session || !props.agentPath || saving) return;
    const details = runDetails.current;
    const name = details?.scenario ? `Role-play · ${details.name ?? 'Scenario'}` : session.turns.find(turn => turn.role === 'user')?.text.slice(0, 60) ?? 'Saved conversation';
    const contextVariables = details?.contextVariables ?? session.contextVariables ?? [];
    const next = caseFromRun({ runId: session.id, engine: session.engine === 'preview' ? 'simulate' : 'rehearse', at: Date.now(), file: props.fileLabel, turns: session.turns, traces, ...(contextVariables.length ? { contextVariables } : {}) }, name, details?.scenario?.criteria);
    setSaving(true); setError('');
    try {
      const listed = await callPluginRpc(props.pluginId, STUDIO_RPC.suites, { projectId: props.projectId, agentPath: props.agentPath }) as { ok?: boolean; error?: string; suites?: Array<{ cases: ScenarioCase[]; sha256?: string; path: string }> };
      if (listed?.ok === false) throw new Error(listed.error || 'Could not read the scenario suite.');
      const fresh = listed?.suites?.[0];
      const reply = await callPluginRpc(props.pluginId, STUDIO_RPC.suiteSave, { projectId: props.projectId, agentPath: props.agentPath, cases: [...(fresh?.cases ?? []), next], ...(fresh?.sha256 ? { expectedSha256: fresh.sha256 } : {}) }) as { ok?: boolean; error?: string; suite?: { path: string } };
      if (!reply?.ok || !reply.suite) throw new Error(reply?.error || 'The case could not be saved.');
      if (alive.current) setSaved(`Saved “${next.name}” to ${reply.suite.path}`);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (alive.current) setSaving(false); }
  }
  function select(index: number, showTrace = true) {
    setSelected(index);
    if (showTrace) { setEvidenceView('trace'); setMobilePane('trace'); }
    // Move only the conversation scroller; scrollIntoView would also move the surrounding Studio.
    const scroller = transcript.current;
    const reply = scroller?.querySelector<HTMLElement>(`[data-turn="${index}"]`);
    if (scroller && reply && !split.stacked) scroller.scrollTo?.({ top: scroller.scrollTop + reply.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12, behavior: 'smooth' });
    evidence.current?.scrollTo?.({ top: 0 });
  }

  const running = Boolean(session && !session.closed && !session.failed && !(session.execution && ['done', 'stopped', 'error'].includes(session.execution.phase)));
  const testing = props.mode === 'test';
  const shared = props.scenarioLibrary;
  const appliedSelection = useRef<number | undefined>(undefined);
  const chooseScenario = (row: SavedScenario, reveal = true) => {
    const { name, contextVariables, ...snapshot } = scenarioSnapshot(row);
    setScenario(snapshot); setPresetName(name); context.adopt(contextVariables ?? []);
    setSetupOpen(true); if (reveal && narrow) setSettingsOpen(true);
  };
  useEffect(() => {
    if (!shared || shared.loading || shared.error || libraryInitialized || busy || running) return;
    if (!shared.selection && !scenario.origin && !context.values.length && JSON.stringify(scenario) === JSON.stringify(LAB_SCENARIOS[0].scenario)) {
      const row = shared.scenarios.find(row => row.name === presetName); if (row) chooseScenario(row, false);
    }
    setLibraryInitialized(true);
  }, [shared?.loading, shared?.error, libraryInitialized, busy, running]);
  useEffect(() => {
    if (!shared?.selection || appliedSelection.current === shared.selection.seq || busy || running) return;
    appliedSelection.current = shared.selection.seq; chooseScenario(shared.selection.scenario);
  }, [shared?.selection, busy, running]);
  const stale = Boolean(session && props.source !== runSource);
  const exchanges = labExchanges(session?.turns ?? []);
  const planned = testing && session ? runDetails.current?.scenario?.maxTurns ?? 0 : 0;
  const steps = labSteps(exchanges, planned, busy);
  const answered = steps.filter(step => step === 'done').length;
  const waiting = busy && Boolean(session);
  const customerWriting = session?.execution ? session.execution.phase === 'customer' : outgoing === null && Boolean(session?.turns.length);
  const sent = exchanges.filter(row => row.index > 0).length + (outgoing === null ? 0 : 1);
  const upcoming = (from: number) => Array.from({ length: Math.max(0, planned - from) }, (_, i) => from + i + 1);
  const ghosts = waiting ? upcoming(sent) : [];
  const who = (turn: LabTurn) => turn.role === 'agent' ? 'Agentforce' : testing ? 'AI customer' : 'You';
  const topicOf = (turn: LabTurn) => turn.planId ? traceTopics(traces[turn.planId]).at(-1) : undefined;
  const pendingTurn = waiting ? steps.indexOf('cur') + 1 || (outgoing === null ? 0 : sent) : 0;
  const turnIndexes = exchanges.map(row => row.index);
  if (waiting && pendingTurn > 0 && !turnIndexes.includes(pendingTurn)) turnIndexes.push(pendingTurn);
  const selectedTurn = (selected !== null && turnIndexes.includes(selected) ? selected : null) ?? (waiting && pendingTurn > 0 ? pendingTurn : exchanges.at(-1)?.index ?? null);
  const selectedRow = exchanges.find(row => row.index === selectedTurn);
  const position = selectedTurn === null ? -1 : turnIndexes.indexOf(selectedTurn);
  const recordedEngine = session?.engine ?? engine;
  const raw = evidenceView === 'raw' ? JSON.stringify({ runId: session?.id, engine: session?.engine, turn: selectedTurn, exchange: selectedRow, traces: Object.fromEntries((selectedRow?.agents ?? []).flatMap(({ turn }) => turn.planId && traces[turn.planId] ? [[turn.planId, traces[turn.planId]]] : [])) }, null, 2) : '';

  return <aside ref={root} className="af-lab af-lab-split af-roleplay" hidden={props.hidden} aria-label="Agentforce rehearsal" data-testid="agentforce-lab" data-run-id={session?.id} data-narrow={narrow}>
    <style>{PREVIEW_CONTEXT_STYLES}{STUDIO_RESIZE_STYLES}</style>
    <header className="af-roleplay-toolbar" inert={narrow && settingsOpen}>
      <span className="af-icon">{testing ? <FlaskConical /> : <Bot />}</span><strong>{testing ? 'Role-play' : 'Conversation'}</strong>
      {session && <div className="af-run-meta" aria-label="Recorded run"><span>{session.engine === 'preview' ? 'Preview API' : 'AI approximation'}</span><span>{session.orgAlias}</span><span title={session.sourceHash}>Draft {session.sourceHash.slice(0, 7)}</span></div>}
      <span className="af-spacer" />
      {narrow && <button ref={setupButton} type="button" className="af-setup-toggle" aria-expanded={settingsOpen} aria-controls={setupId} onClick={() => setSettingsOpen(true)}>Setup</button>}
      {!busy && <button className="af-primary" type="button" disabled={!props.source.trim() || context.loading || Boolean(context.error)} onClick={() => void perform(() => begin(testing))}><span aria-hidden="true">▶</span>{testing ? (session ? 'Run again' : 'Run AI role-play') : running ? 'New conversation' : 'Start conversation'}</button>}
      {(busy || running) && <button type="button" className="af-stop" onClick={() => void stop()}>Stop</button>}
    </header>
    <style>{`.af-shared-scenario{display:flex;flex-direction:column;gap:10px;padding:12px 0}.af-shared-scenario label{display:flex;flex-direction:column;gap:6px}.af-shared-scenario select,.sf-shared-save input{font:inherit;max-width:100%;padding:8px;border:1px solid var(--sf-border);border-radius:6px;color:var(--sf-text);background:var(--sf-bg)}.sf-shared-save{padding:12px 0}.sf-shared-save form{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.sf-shared-save label{display:flex;flex-direction:column;gap:6px}`}</style><div className="af-roleplay-body">
      {narrow && settingsOpen && <div className="af-setup-backdrop" onClick={closeSetup} />}
      <section ref={setup} id={setupId} className="af-setup" hidden={narrow && !settingsOpen} role={narrow ? 'dialog' : 'region'} aria-modal={narrow ? true : undefined} aria-label="Run setup" onKeyDown={event => {
        if (!narrow) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSetup(); }
        if (event.key === 'Tab') {
          const controls = [...(setup.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary') ?? [])].filter(el => el.getClientRects().length);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <header className="af-setup-head"><strong>Run setup</strong>{narrow && <button type="button" onClick={closeSetup} aria-label="Close run setup">Close</button>}</header>
        <div className="af-setup-scroll">
          <p className="af-caption">{session ? 'Settings apply to your next run.' : 'Choose how to test this draft.'}</p>
          <div className="af-engine" role="group" aria-label="Rehearsal engine">
            <button type="button" aria-pressed={engine === 'preview'} disabled={busy || running} onClick={() => setEngine('preview')}><strong>Salesforce Preview</strong><span>Real runtime · simulated actions</span></button>
            <button type="button" aria-pressed={engine === 'rehearsal'} disabled={busy || running} onClick={() => setEngine('rehearsal')}><strong>AI rehearsal</strong><span>Script only · no actions</span></button>
          </div>
          {testing && shared && <div className="af-shared-scenario">
            <label>Shared scenario<select aria-label="Shared scenario" disabled={busy || running || shared.loading} value={shared.scenarios.some(row => row.id === scenario.origin?.id) ? scenario.origin?.id : ''} onChange={event => { const row = shared.scenarios.find(row => row.id === event.target.value); if (row) chooseScenario(row); else if (!event.target.value) { setScenario({ ...scenario, origin: undefined }); setPresetName('Custom scenario'); } }}>
              <option value="">Local run setup</option>{shared.scenarios.map(row => <option key={row.id} value={row.id}>{row.name} · revision {row.revision}</option>)}
            </select></label>
            <button type="button" className="sf-tp-btn" onClick={shared.onManage}>Manage scenarios</button>
            {scenario.origin && <p className="af-caption">Based on {scenario.origin.name} · revision {scenario.origin.revision}. Edits below apply to this run only.</p>}
            {shared.selection && appliedSelection.current !== shared.selection.seq && (busy || running) && <p role="status">Your selected scenario will be ready after this run ends.</p>}
            {shared.error && <p role="alert">{shared.error}</p>}
          </div>}
          {testing && <details className="af-scenario-details" open={setupOpen} onToggle={e => setSetupOpen(e.currentTarget.open)}><summary>Scenario setup <span>{scenario.maxTurns} turns · {presetName}</span></summary><fieldset className="af-scenario" disabled={busy || running}>
            <legend>SCENARIO</legend>
            {!shared && <div className="af-presets">{LAB_SCENARIOS.map(p => <button type="button" key={p.name} aria-pressed={presetName === p.name} onClick={() => { setScenario({ ...p.scenario }); setPresetName(p.name); }}>{p.name}</button>)}</div>}
            <label>Customer persona<textarea rows={2} value={scenario.persona} maxLength={2000} onChange={e => setScenario({ ...scenario, persona: e.target.value })} /></label>
            <label>Customer goal<textarea rows={2} value={scenario.goal} maxLength={2000} onChange={e => setScenario({ ...scenario, goal: e.target.value })} /></label>
            <label>Opening message<input value={scenario.opening} maxLength={4000} onChange={e => setScenario({ ...scenario, opening: e.target.value })} /></label>
            <label>Success criteria<textarea rows={2} value={scenario.criteria} maxLength={4000} onChange={e => setScenario({ ...scenario, criteria: e.target.value })} /></label>
            <label className="af-turn-limit">Conversation budget<select value={scenario.maxTurns} onChange={e => setScenario({ ...scenario, maxTurns: Number(e.target.value) })}>{[1,2,3,4,5,6,7,8].map(n => <option value={n} key={n}>{n} turn{n > 1 ? 's' : ''}</option>)}</select></label>
          </fieldset></details>}
          {testing && shared && <SaveSharedScenario library={shared} scenario={scenario} name={presetName} values={context.values} disabled={busy || running || Boolean(context.error)} />}
          <details className="af-context-details"><summary>Initial variables <span>{context.error ? 'Review values' : context.count ? `${context.count} overrides` : 'Runtime defaults'}</span></summary>
            <fieldset className="af-context-fields" disabled={busy}><PreviewContextEditor context={context} running={running} /></fieldset>
          </details>

          {(testing || engine === 'rehearsal') && <details className="af-model"><summary>AI model & usage</summary><label>Salesforce model API name<input value={model} disabled={busy || running} onChange={e => setModel(e.target.value)} maxLength={160} /></label><p>Uses the selected org’s Models API and consumes Einstein requests. The org needs access to this model. AI judgments are advisory.</p></details>}
        </div>
      </section>
      <div className="af-roleplay-workspace" inert={narrow && settingsOpen} data-compact={split.stacked} data-pane={mobilePane}>
        {split.stacked && <div className="af-mobile-tabs" role="group" aria-label="Run view"><button type="button" aria-pressed={mobilePane === 'conversation'} onClick={() => setMobilePane('conversation')}>Conversation</button><button type="button" aria-pressed={mobilePane === 'trace'} onClick={() => setMobilePane('trace')}>Turn trace</button></div>}
        <div className="af-lab-grid" ref={split.ref} style={split.style}>
          <section className="af-lab-left" aria-label="Conversation">
            <header className="af-lab-head"><strong>Conversation</strong><span className="af-caption">{exchanges.filter(row => row.index > 0).length} turns{planned ? ` · ${answered}/${planned} answered` : ''}</span></header>
            {planned > 0 && <ol className="af-stepper" aria-label="Scenario progress">{steps.map((step, i) => <li key={i} className={`af-step is-${step}`} aria-current={step === 'cur' ? 'step' : undefined}><i aria-hidden="true" />{i + 1} · {i === 0 ? 'Opening' : i + 1 === planned ? 'Wrap-up' : 'Follow-up'}</li>)}</ol>}
            <div className="af-lab-scroll" ref={transcript}>
              <p className="af-caption">{recordedEngine === 'preview' ? 'Tests this editor draft through the Preview API. Nothing is published.' : 'An AI model plays your script. This does not validate Agentforce runtime behavior.'}</p>
              {stale && <p className="af-notice">Your script changed. This conversation uses the earlier snapshot. Start a new run to test your edits.</p>}
              {error && <div className="af-error" role="alert">{error}</div>}
              <div className="af-transcript" role="log" aria-label="Rehearsal conversation" data-testid="agentforce-lab-transcript">
                {!session?.turns.length && !waiting && (busy ? <LoadingState compact art="agents" label="Starting your conversation…" /> : <div className="af-welcome"><span className="af-welcome-orbit"><Bot /></span><h3>{testing ? 'Put your agent to the test' : 'Every great agent starts with a conversation'}</h3><p>{testing ? 'Choose a customer and a goal. AI will play the customer, then review the conversation against your criteria.' : 'Ask a real question, follow up, and see how your agent handles the conversation.'}</p><span className="af-welcome-tag">{props.fileLabel || 'Current draft'}</span></div>)}
                {exchanges.flatMap(row => [...(row.user ? [row.user] : []), ...row.agents].map(({ turn, at }) => {
                  const topic = topicOf(turn);
                  return <article key={at} data-turn={row.index} className={`af-message is-${turn.role}${selectedTurn === row.index ? ' is-selected' : ''}`}>
                    <div className="af-message-body">
                      <span className="af-message-meta"><strong>{who(turn)}</strong><span>{row.index ? `turn ${row.index}` : 'welcome'}</span></span>
                      <span className="af-message-text">{turn.text}</span>
                      {turn.role === 'agent' && (topic || turn.latencyMs !== undefined) && <span className="af-message-tags">{topic && <span className="af-chip is-topic">{topic}</span>}{turn.latencyMs !== undefined && <span className="af-chip">{(turn.latencyMs / 1000).toFixed(1)}s</span>}</span>}
                      {turn.role === 'agent' && <button type="button" className="af-view-trace" aria-pressed={selectedTurn === row.index} aria-label={`View trace for ${row.index ? `turn ${row.index}` : 'welcome'}`} onClick={() => select(row.index)}>View trace <span aria-hidden="true">›</span></button>}
                    </div>
                  </article>;
                }))}
                {outgoing !== null && <article className="af-message is-user is-outgoing"><span className="af-message-body"><span className="af-message-meta"><strong>{testing ? 'AI customer' : 'You'}</strong><span>turn {sent}</span></span><span className="af-message-text">{outgoing}</span></span></article>}
                {waiting && <div className={`af-typing${customerWriting ? ' is-customer' : ''}`} role="status" aria-label={customerWriting ? 'Customer is writing' : 'Agent is replying'}><i /><i /><i /></div>}
                {ghosts.map(n => <div key={n} className="af-message is-user is-ghost" aria-hidden="true"><span className="af-message-meta"><strong>Turn {n}</strong><span>AI customer</span></span><span className="af-message-text">Written after the agent replies.</span></div>)}
              </div>
              {verdict && <section className={`af-verdict is-${verdict.outcome}`} aria-label="AI evaluation"><div><strong>{verdict.outcome === 'pass' ? 'Criteria met' : verdict.outcome === 'fail' ? 'Needs attention' : 'More evidence needed'}</strong><span>AI assessment</span></div><p>{verdict.reason}</p><ul>{verdict.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul><small>Advisory result · not release approval</small></section>}
            </div>
            {!testing && session && !busy && <form className="af-composer" onSubmit={e => { e.preventDefault(); void perform(send); }}><input aria-label="Rehearsal message" placeholder={running ? 'Ask your agent something…' : 'Start a new conversation to keep going'} disabled={!running} value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} /><button type="submit" aria-label="Send rehearsal message" disabled={!running || !draft.trim()}>↑</button></form>}
          </section>
          {split.divider('Resize conversation and evidence')}
          <section className="af-lab-right" aria-label="Evidence">
            <header className="af-lab-head is-evidence"><strong>Turn trace · {selectedTurn === null ? 'No turn selected' : selectedTurn === 0 ? 'Welcome' : `Turn ${selectedTurn}`}</strong>
              <div className="af-turn-nav" role="group" aria-label="Trace turn"><button type="button" aria-label="Previous turn" disabled={position <= 0} onClick={() => select(turnIndexes[position - 1]!, false)}><span aria-hidden="true">‹</span> Previous</button><button type="button" aria-label="Next turn" disabled={position < 0 || position >= turnIndexes.length - 1} onClick={() => select(turnIndexes[position + 1]!, false)}>Next <span aria-hidden="true">›</span></button></div>
              <div className="af-seg" role="group" aria-label="Evidence view"><button type="button" aria-pressed={evidenceView === 'trace'} onClick={() => setEvidenceView('trace')}>Trace</button><button type="button" aria-pressed={evidenceView === 'raw'} disabled={!selectedRow} onClick={() => setEvidenceView('raw')}>Raw JSON</button></div>
            </header>
            <div className="af-evidence" ref={evidence} data-testid="agentforce-lab-evidence">
              {evidenceView === 'raw' ? <pre className="af-raw">{raw.length > RAW_LIMIT ? `${raw.slice(0, RAW_LIMIT)}\n… truncated · use Export run for the full record` : raw}</pre> : selectedTurn === null ? <p className="af-evidence-empty">Evidence appears here as the agent replies. Select View trace on a reply to inspect its routing, actions, and timing.</p> : <article className="af-ev-turn is-selected" data-turn={selectedTurn}>
                <h4>{selectedTurn ? `Turn ${selectedTurn}` : 'Welcome'}</h4>
                {selectedRow?.user && <p className="af-selected-question">{selectedRow.user.turn.text}</p>}
                {selectedRow?.agents.map(({ turn, at }) => <div key={at} className="af-ev-reply">
                  {turn.planId && <span className="af-ev-plan" title={turn.planId}>Plan {turn.planId}</span>}
                  {session?.engine === 'preview'
                    ? turn.planId ? <TracePanel trace={traces[turn.planId] ?? null} loading={!traces[turn.planId]} /> : <span className="af-evidence-empty">No plan id was returned for this reply.</span>
                    : <TracePanel trace={null} approximation />}
                </div>)}
                {!waiting && selectedRow && !selectedRow.agents.length && <div className="af-evidence-empty">No agent reply was recorded for this turn.</div>}
                {waiting && selectedTurn === pendingTurn && !selectedRow?.agents.length && <div className="af-ev-pending" role="status">{customerWriting ? 'Customer is writing…' : 'Agent replying…'}</div>}
              </article>}
            </div>
          </section>
        </div>
      </div>
    </div>
    <footer className="af-statusbar" inert={narrow && settingsOpen}>
      {busy && <span className="af-dot" aria-hidden="true" />}
      <span className={busy ? 'af-status is-busy' : 'af-status'} aria-live="polite">{status}</span>
      {busy && <span className="af-elapsed">{elapsed(phaseAt, now)}</span>}
      {saved && !busy && <span className="af-saved" role="status">{saved}</span>}
      <span className="af-spacer" />
      {props.agentPath && session?.turns.some(turn => turn.role === 'user') && !busy && <button type="button" className="af-text-button" disabled={saving} onClick={() => void saveAsCase()}>{saving ? 'Saving…' : 'Save as test case'}</button>}
      {session && <button type="button" className="af-text-button" onClick={exportRun}>Export run</button>}
    </footer>
  </aside>;
}
