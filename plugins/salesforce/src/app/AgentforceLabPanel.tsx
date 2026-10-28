import { useEffect, useRef, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { DEFAULT_LAB_MODEL, LAB_SCENARIOS, parseLabScenario, type LabEngine, type LabScenario, type LabSnapshot, type LabTurn, type LabVerdict } from '../../lib/agentforce-lab-contract.js';
import { STUDIO_RESIZE_STYLES, useStudioSplit } from './studio/StudioResize.js';
import { Bot, FlaskConical } from './components/icons.js';
import { LoadingState } from './components/SalesforceState.js';
import { TracePanel } from './preview/TracePanel.js';
import { PREVIEW_CONTEXT_STYLES, PreviewContextEditor, usePreviewContext } from './preview/PreviewContext.js';
import { parsePreviewContext, type PreviewContextVariable } from '../../lib/preview-context.js';
import type { AppliedContextPreset } from '../../lib/preview-context-preset-contract.js';
import { caseFromRun, traceTopics } from './agentforce-preview-logic.js';
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

export function AgentforceLabPanel(props: { pluginId: string; projectId?: string; threadId?: string; orgAlias?: string; source: string; mode: 'rehearse' | 'test'; fileLabel: string; hidden?: boolean; /** The .agent file; enables Save as test case. */ agentPath?: string }) {
  const split = useStudioSplit({ storageKey: `salesforce:studio:lab:${props.projectId ?? 'draft'}`, initial: 48 });
  const context = usePreviewContext({ pluginId: props.pluginId, projectId: props.projectId, source: props.source, path: props.agentPath, orgAlias: props.orgAlias, scope: `${props.projectId ?? ''}:${props.agentPath ?? ''}:${props.orgAlias ?? ''}` });
  const [engine, setEngine] = useState<LabEngine>('preview');
  const [model, setModel] = useState(DEFAULT_LAB_MODEL);
  const [scenario, setScenario] = useState<LabScenario>({ ...LAB_SCENARIOS[0].scenario });
  const [presetName, setPresetName] = useState(LAB_SCENARIOS[0].name);
  const [session, setSession] = useState<LabSnapshot | null>(null);
  const [verdict, setVerdict] = useState<LabVerdict | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatusText] = useState('Ready when you are');
  const [phaseAt, setPhaseAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [runSource, setRunSource] = useState('');
  const [setupOpen, setSetupOpen] = useState(true);
  const [traces, setTraces] = useState<Record<string, TurnTrace>>({});
  const [evidenceView, setEvidenceView] = useState<'trace' | 'raw'>('trace');
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  /** The customer message in flight, shown before the agent's reply lands. */
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const active = useRef<LabSnapshot | null>(null);
  const locked = useRef(false);
  const cancelled = useRef(false);
  const alive = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  const evidence = useRef<HTMLDivElement>(null);
  const requested = useRef(new Set<string>());
  const runDetails = useRef<{ source: string; file: string; scenario?: LabScenario; name?: string; contextVariables: PreviewContextVariable[]; contextPreset: AppliedContextPreset | null } | null>(null);

  const rpc = async <T,>(method: string, args: Record<string, unknown>): Promise<T> => {
    const result = await callPluginRpc(props.pluginId, `agentLab.${method}`, { projectId: props.projectId, ...args }) as { ok: boolean; data?: T; error?: string };
    if (!result?.ok || result.data === undefined) throw new Error(result?.error || 'The rehearsal could not complete.');
    return result.data;
  };
  const setStatus = (text: string) => { setStatusText(text); setPhaseAt(Date.now()); };
  const update = (value: LabSnapshot) => {
    active.current = value;
    if (alive.current) setSession(value);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelled.current = true;
      if (active.current && !active.current.closed) void callPluginRpc(props.pluginId, 'agentLab.end', { projectId: props.projectId, id: active.current.id }).catch(() => undefined);
    };
  }, [props.pluginId, props.projectId]);
  useEffect(() => { if (session?.turns.length) transcript.current?.scrollTo?.({ top: transcript.current.scrollHeight, behavior: 'smooth' }); }, [session?.turns.length, status]);
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
      if (alive.current && !cancelled.current) { setError(err instanceof Error ? err.message : String(err)); setStatus('Run incomplete'); }
      if (active.current && !active.current.closed) {
        try { update(await rpc<LabSnapshot>('end', { id: active.current.id })); } catch { /* Original error stays visible. */ }
      }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function begin(test: boolean) {
    if (context.error) throw new Error(context.error);
    const contextVariables = parsePreviewContext(context.values);
    const contextPreset = context.presetIdentity;
    const selectedScenario = test ? parseLabScenario(scenario) : undefined;
    if (active.current && !active.current.closed) await rpc('end', { id: active.current.id });
    setVerdict(null); setSession(null); setOutgoing(null); setTraces({}); setSelected(null); setSaved(''); active.current = null; requested.current = new Set();
    if (selectedScenario) setSetupOpen(false);
    runDetails.current = { source: props.source, file: props.fileLabel, scenario: selectedScenario, contextVariables, contextPreset, ...(selectedScenario ? { name: presetName } : {}) };
    setRunSource(props.source);
    setStatus(engine === 'preview' ? 'Compiling draft in Salesforce…' : 'Preparing AI rehearsal…');
    const started = await rpc<LabSnapshot>('start', { engine, model, source: props.source, ...(props.agentPath ? { path: props.agentPath } : {}), ...(contextVariables.length ? { contextVariables } : {}), ...(props.threadId ? { threadId: props.threadId } : {}), ...(selectedScenario ? { scenario: selectedScenario } : {}) });
    update(started);
    if (cancelled.current || !alive.current) { update(await rpc<LabSnapshot>('end', { id: started.id })); return; }
    context.markApplied(contextVariables, contextPreset);
    if (!selectedScenario) { setStatus('Conversation ready'); return; }
    let text = selectedScenario.opening;
    for (let i = 0; i < selectedScenario.maxTurns; i++) {
      if (cancelled.current || !alive.current) return;
      setStatus(`Turn ${i + 1} of ${selectedScenario.maxTurns} · Agent replying…`);
      setOutgoing(text);
      const next = await rpc<LabSnapshot>('send', { id: started.id, text });
      if (cancelled.current || !alive.current) return;
      update(next); setOutgoing(null);
      if (i + 1 < selectedScenario.maxTurns) {
        setStatus(`Turn ${i + 2} of ${selectedScenario.maxTurns} · Customer thinking…`);
        text = (await rpc<{ text: string }>('next', { id: started.id })).text;
      }
    }
    if (cancelled.current || !alive.current) return;
    setStatus('Evaluating the conversation…');
    const evaluation = await rpc<{ verdict: LabVerdict }>('evaluate', { id: started.id });
    if (cancelled.current || !alive.current) return;
    update(await rpc<LabSnapshot>('end', { id: started.id }));
    if (cancelled.current || !alive.current) return;
    setVerdict(evaluation.verdict);
    setStatus('Run complete');
  }
  async function loadTrace(id: string, planId: string) {
    const unavailable = (reason: string): TurnTrace => ({ runId: id, turn: 0, planId, available: false, reason, steps: [] });
    try {
      const result = await callPluginRpc(props.pluginId, STUDIO_RPC.trace, { projectId: props.projectId, id, planId }) as { ok?: boolean; data?: TurnTrace; error?: string };
      const trace = result?.ok && result.data ? result.data : unavailable(result?.error || 'Trace request failed.');
      if (alive.current) setTraces(prev => ({ ...prev, [planId]: trace }));
    } catch (err) { if (alive.current) setTraces(prev => ({ ...prev, [planId]: unavailable(err instanceof Error ? err.message : String(err)) })); }
  }
  async function stop() {
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
      if (cancelled.current || !alive.current) return;
      update(result); setDraft(''); setStatus('Your turn');
    } finally { if (alive.current) setOutgoing(null); }
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
  function select(index: number) {
    setSelected(index);
    setEvidenceView('trace');
    window.setTimeout(() => evidence.current?.querySelector(`[data-turn="${index}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 0);
  }

  const running = Boolean(session && !session.closed);
  const testing = props.mode === 'test';
  const stale = Boolean(session && props.source !== runSource);
  const exchanges = labExchanges(session?.turns ?? []);
  const planned = testing && session ? runDetails.current?.scenario?.maxTurns ?? 0 : 0;
  const steps = labSteps(exchanges, planned, busy);
  const answered = steps.filter(step => step === 'done').length;
  const waiting = busy && Boolean(session);
  const sent = exchanges.filter(row => row.index > 0).length + (outgoing === null ? 0 : 1);
  const upcoming = (from: number) => Array.from({ length: Math.max(0, planned - from) }, (_, i) => from + i + 1);
  const ghosts = waiting ? upcoming(sent) : [];
  const who = (turn: LabTurn) => turn.role === 'agent' ? 'Agentforce' : testing ? 'AI customer' : 'You';
  const topicOf = (turn: LabTurn) => turn.planId ? traceTopics(traces[turn.planId]).at(-1) : undefined;
  const pendingTurn = waiting ? steps.indexOf('cur') + 1 || (outgoing === null ? 0 : sent) : 0;
  const raw = evidenceView === 'raw' ? JSON.stringify({ session, traces, verdict }, null, 2) : '';

  return <aside className="af-lab af-lab-split" hidden={props.hidden} aria-label="Agentforce rehearsal" data-testid="agentforce-lab">
    <style>{PREVIEW_CONTEXT_STYLES}{STUDIO_RESIZE_STYLES}</style>
    <div className="af-lab-grid" ref={split.ref} style={split.style} data-stacked={split.stacked}>
      <section className="af-lab-left" aria-label="Conversation">
        <header className="af-lab-head">
          <span className="af-icon">{testing ? <FlaskConical /> : <Bot />}</span>
          <div className="af-engine" role="group" aria-label="Rehearsal engine">
            <button type="button" aria-pressed={engine === 'preview'} disabled={busy || running} onClick={() => setEngine('preview')}><strong>Salesforce Preview</strong><span>Real runtime · simulated actions</span></button>
            <button type="button" aria-pressed={engine === 'rehearsal'} disabled={busy || running} onClick={() => setEngine('rehearsal')}><strong>AI rehearsal</strong><span>Script only · no actions</span></button>
          </div>
          {session && <div className="af-run-meta"><span>{session.engine === 'preview' ? 'Preview API' : 'AI approximation'}</span><span>{session.orgAlias}</span><span title={session.sourceHash}>Draft {session.sourceHash.slice(0, 7)}</span></div>}
        </header>
        {planned > 0 && <ol className="af-stepper" aria-label="Scenario progress">{steps.map((step, i) => <li key={i} className={`af-step is-${step}`} aria-current={step === 'cur' ? 'step' : undefined}><i aria-hidden="true" />{i + 1} · {i === 0 ? 'Opening' : i + 1 === planned ? 'Wrap-up' : 'Follow-up'}</li>)}</ol>}
        <div className="af-lab-scroll" ref={transcript}>
          <p className="af-caption">{engine === 'preview' ? 'Tests this editor draft through the Preview API. Nothing is published.' : 'An AI model plays your script. This does not validate Agentforce runtime behavior.'}</p>
          {testing && <details className="af-scenario-details" open={setupOpen} onToggle={e => setSetupOpen(e.currentTarget.open)}><summary>Scenario setup <span>{scenario.maxTurns} turns · {presetName}</span></summary><fieldset className="af-scenario" disabled={busy || running}>
            <legend>SCENARIO</legend>
            <div className="af-presets">{LAB_SCENARIOS.map(p => <button type="button" key={p.name} aria-pressed={presetName === p.name} onClick={() => { setScenario({ ...p.scenario }); setPresetName(p.name); }}>{p.name}</button>)}</div>
            <label>Customer persona<textarea rows={2} value={scenario.persona} maxLength={2000} onChange={e => setScenario({ ...scenario, persona: e.target.value })} /></label>
            <label>Customer goal<textarea rows={2} value={scenario.goal} maxLength={2000} onChange={e => setScenario({ ...scenario, goal: e.target.value })} /></label>
            <label>Opening message<input value={scenario.opening} maxLength={4000} onChange={e => setScenario({ ...scenario, opening: e.target.value })} /></label>
            <label>Success criteria<textarea rows={2} value={scenario.criteria} maxLength={4000} onChange={e => setScenario({ ...scenario, criteria: e.target.value })} /></label>
            <label className="af-turn-limit">Conversation budget<select value={scenario.maxTurns} onChange={e => setScenario({ ...scenario, maxTurns: Number(e.target.value) })}>{[1,2,3,4,5,6,7,8].map(n => <option value={n} key={n}>{n} turn{n > 1 ? 's' : ''}</option>)}</select></label>
          </fieldset></details>}
          <details className="af-context-details"><summary>Initial variables <span>{context.error ? 'Review values' : context.count ? `${context.count} overrides` : 'Runtime defaults'}</span></summary>
            <fieldset className="af-context-fields" disabled={busy}><PreviewContextEditor context={context} running={running} /></fieldset>
          </details>
          {(testing || engine === 'rehearsal') && <details className="af-model"><summary>AI model & usage</summary><label>Salesforce model API name<input value={model} disabled={busy || running} onChange={e => setModel(e.target.value)} maxLength={160} /></label><p>Uses the selected org’s Models API and consumes Einstein requests. The org needs access to this model. AI judgments are advisory.</p></details>}
          {!busy && <div className="af-run-actions"><button className="af-primary" type="button" disabled={!props.source.trim() || context.loading || Boolean(context.error)} onClick={() => void perform(() => begin(testing))}>{testing ? (session ? 'Run again' : 'Run AI role-play') : running ? 'New conversation' : 'Start conversation'}<span aria-hidden="true">↗</span></button></div>}
          {stale && <p className="af-notice">Your script changed. This conversation uses the earlier snapshot. Start a new run to test your edits.</p>}
          {error && <div className="af-error" role="alert">{error}</div>}
          <div className="af-transcript" role="log" aria-label="Rehearsal conversation" data-testid="agentforce-lab-transcript">
            {!session?.turns.length && !waiting && (busy ? <LoadingState compact art="agents" label="Starting your conversation…" /> : <div className="af-welcome"><span className="af-welcome-orbit"><Bot /></span><h3>{testing ? 'Put your agent to the test' : 'Every great agent starts with a conversation'}</h3><p>{testing ? 'Choose a customer and a goal. AI will play the customer, then review the conversation against your criteria.' : 'Ask a real question, follow up, and see how your agent handles the conversation.'}</p><span className="af-welcome-tag">{props.fileLabel || 'Current draft'}</span></div>)}
            {exchanges.flatMap(row => [...(row.user ? [row.user] : []), ...row.agents].map(({ turn, at }) => {
              const topic = topicOf(turn);
              return <article key={at} className={`af-message is-${turn.role}${selected === row.index ? ' is-selected' : ''}`}>
                <button type="button" className="af-message-body" aria-label={`Show evidence for turn ${row.index}`} onClick={() => select(row.index)}>
                  <span className="af-message-meta"><strong>{who(turn)}</strong><span>{row.index ? `turn ${row.index}` : 'welcome'}</span></span>
                  <span className="af-message-text">{turn.text}</span>
                  {turn.role === 'agent' && (topic || turn.latencyMs !== undefined) && <span className="af-message-tags">{topic && <span className="af-chip is-topic">{topic}</span>}{turn.latencyMs !== undefined && <span className="af-chip">{(turn.latencyMs / 1000).toFixed(1)}s</span>}</span>}
                </button>
              </article>;
            }))}
            {outgoing !== null && <article className="af-message is-user is-outgoing"><span className="af-message-body"><span className="af-message-meta"><strong>{testing ? 'AI customer' : 'You'}</strong><span>turn {sent}</span></span><span className="af-message-text">{outgoing}</span></span></article>}
            {waiting && <div className={`af-typing${outgoing === null && session?.turns.length ? ' is-customer' : ''}`} role="status" aria-label={outgoing === null && session?.turns.length ? 'Customer is writing' : 'Agent is replying'}><i /><i /><i /></div>}
            {ghosts.map(n => <div key={n} className="af-message is-user is-ghost" aria-hidden="true"><span className="af-message-meta"><strong>Turn {n}</strong><span>AI customer</span></span><span className="af-message-text">Written after the agent replies.</span></div>)}
          </div>
          {verdict && <section className={`af-verdict is-${verdict.outcome}`} aria-label="AI evaluation"><div><strong>{verdict.outcome === 'pass' ? 'Criteria met' : verdict.outcome === 'fail' ? 'Needs attention' : 'More evidence needed'}</strong><span>AI assessment</span></div><p>{verdict.reason}</p><ul>{verdict.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul><small>Advisory result · not release approval</small></section>}
        </div>
        {!testing && session && !busy && <form className="af-composer" onSubmit={e => { e.preventDefault(); void perform(send); }}><input aria-label="Rehearsal message" placeholder={running ? 'Ask your agent something…' : 'Start a new conversation to keep going'} disabled={!running} value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} /><button type="submit" aria-label="Send rehearsal message" disabled={!running || !draft.trim()}>↑</button></form>}
        <footer className="af-statusbar">
          {busy && <span className="af-dot" aria-hidden="true" />}
          <span className={busy ? 'af-status is-busy' : 'af-status'} aria-live="polite">{status}</span>
          {busy && <span className="af-elapsed">{elapsed(phaseAt, now)}</span>}
          {saved && !busy && <span className="af-saved" role="status">{saved}</span>}
          <span className="af-spacer" />
          {props.agentPath && session?.turns.some(turn => turn.role === 'user') && !busy && <button type="button" className="af-text-button" disabled={saving} onClick={() => void saveAsCase()}>{saving ? 'Saving…' : 'Save as test case'}</button>}
          {session && <button type="button" className="af-text-button" onClick={exportRun}>Export run</button>}
          {(busy || running) && <button type="button" className="af-stop" onClick={() => void stop()}>Stop</button>}
        </footer>
      </section>
      {split.divider('Resize conversation and evidence')}
      <section className="af-lab-right" aria-label="Evidence">
        <header className="af-lab-head is-evidence"><strong>Evidence</strong><div className="af-seg" role="group" aria-label="Evidence view"><button type="button" aria-pressed={evidenceView === 'trace'} onClick={() => setEvidenceView('trace')}>Trace</button><button type="button" aria-pressed={evidenceView === 'raw'} disabled={!session} onClick={() => setEvidenceView('raw')}>Raw JSON</button></div></header>
        <div className="af-evidence" ref={evidence} data-testid="agentforce-lab-evidence">
          {evidenceView === 'raw' ? <pre className="af-raw">{raw.length > RAW_LIMIT ? `${raw.slice(0, RAW_LIMIT)}\n… truncated · use Export run for the full record` : raw}</pre> : <>
            {!exchanges.length && !waiting && <p className="af-evidence-empty">Evidence appears here as the agent replies: the topic each reply routed to, the actions it ran, and how long each step took.</p>}
            {exchanges.map(row => {
              const latency = row.agents.reduce((sum, { turn }) => sum + (turn.latencyMs ?? 0), 0);
              const pending = row.index === pendingTurn && !row.agents.length;
              return <article key={row.index} className={`af-ev-turn${selected === row.index ? ' is-selected' : ''}`} data-turn={row.index}>
                <h4><span>{row.index ? `Turn ${row.index}` : 'Welcome'}</span><span>{pending ? 'running' : latency ? `${(latency / 1000).toFixed(1)} s` : ''}</span></h4>
                {row.agents.map(({ turn, at }) => <div key={at} className="af-ev-reply">
                  {turn.planId && <span className="af-ev-plan" title={turn.planId}>Plan {turn.planId}</span>}
                  {session?.engine === 'preview'
                    ? turn.planId ? <TracePanel trace={traces[turn.planId] ?? null} loading={!traces[turn.planId]} /> : <span className="af-evidence-empty">No plan id was returned for this reply.</span>
                    : <TracePanel trace={null} approximation />}
                </div>)}
                {pending && <div className="af-ev-pending" role="status">Agent replying…</div>}
              </article>;
            })}
            {waiting && pendingTurn > 0 && !exchanges.some(row => row.index === pendingTurn) && <article className="af-ev-turn" data-turn={pendingTurn}><h4><span>Turn {pendingTurn}</span><span>running</span></h4><div className="af-ev-pending" role="status">{outgoing === null ? 'Customer is writing…' : 'Agent replying…'}</div></article>}
            {upcoming(Math.max(pendingTurn, sent)).map(n => <article key={`todo-${n}`} className="af-ev-turn is-todo"><h4><span>Turn {n}</span><span>pending</span></h4></article>)}
          </>}
        </div>
      </section>
    </div>
  </aside>;
}
