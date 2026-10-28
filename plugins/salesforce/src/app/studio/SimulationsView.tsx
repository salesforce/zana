import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Play, SlidersHorizontal } from 'lucide-react';
import { useStudioSplit } from './StudioResize.js';
import { SimulationScenarios } from './SimulationScenarios.js';
import { SIMULATION_STYLES } from './simulation-styles.js';
import { callPluginRpc, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import { SelfHealingPanel } from './SelfHealingPanel.js';
import { LAB_SCENARIOS, type LabEngine } from '../../../lib/agentforce-lab-contract.js';
import { CONTEXT_PRESETS_CHANGED, type ContextPreset } from '../../../lib/preview-context-preset-contract.js';
import { parsePreviewContext } from '../../../lib/preview-context.js';
import { CONTEXT_CHANGED_CHANNEL, STUDIO_CHANGED_CHANNEL } from '../../../lib/studio-contract.js';
import {
  parseSimulationRequest, SIMULATION_LIMITS, SIMULATION_RPC, SIMULATIONS_CHANGED_KIND, isBatchDone, type LaneStatus, type SimulationBatch, type SimulationLane, type SimulationScenarioInput,
} from '../../../lib/simulation-contract.js';

/**
 * Tests > Simulations: a batch of AI role-plays against the open agent, shown as lanes that fill in live.
 * The thread agent starts the same batches with simulations.start and reveals them with simulations.open.
 */
export interface SimulationsFocus { batchId?: string; seq: number }

export interface SimulationsViewProps {
  pluginId: string;
  projectId?: string;
  threadId?: string;
  path: string | null;
  /** The editor source: a run simulates it, unsaved changes included. */
  source: string;
  dirty: boolean;
  visible: boolean;
  focus?: SimulationsFocus | null;
  onFocusHandled?(seq: number): void;
  onAskAgent?(prompt: string): void;
  /** Injected in tests. */
  call?: typeof callPluginRpc;
  pollMs?: number;
}

type Reply = { ok?: boolean; code?: string; error?: string } & Record<string, unknown>;

const STATUS_LABEL: Record<LaneStatus, string> = { queued: 'Queued', running: 'Running', pass: 'Pass', fail: 'Fail', inconclusive: 'Unclear', error: 'Error', stopped: 'Stopped' };
const BATCH_LABEL: Record<SimulationBatch['status'], string> = { running: 'Running', done: 'Done', stopped: 'Stopped', interrupted: 'Interrupted' };

function StatusChip({ status }: { status: LaneStatus }) {
  const tone = status === 'pass' || status === 'fail' ? ` is-${status}` : status === 'running' || status === 'error' ? ` sf-sim-chip is-${status}` : '';
  return <span className={`sf-tp-chip${tone}`}>{STATUS_LABEL[status]}</span>;
}

/** The prompt that hands a finished batch to the thread agent. */
export function improvePrompt(batch: SimulationBatch): string {
  const failing = batch.lanes.filter(lane => lane.status === 'fail' || lane.status === 'inconclusive' || lane.status === 'error');
  return [
    `Improve the Agentforce script ${batch.agentPath} from the Simulation lab batch ${batch.id} (${batch.counts.pass}/${batch.counts.total} pass).`,
    `Read it with sf_workbench simulations.result {batchId: "${batch.id}"}.`,
    ...(failing.length ? [`Failing: ${failing.map(lane => `${lane.name}${lane.repeat > 1 ? ` #${lane.repeat}` : ''}`).join(', ')}.`] : []),
    'Group the failures by cause using the verdict evidence and transcripts, then propose one script change with ui.command editor.proposeEdit.',
    'Re-run the same scenarios with simulations.start and the candidate source to check the fix and that passing lanes still pass.',
    'Do not save, deploy, publish or activate anything.',
  ].join('\n');
}

function laneFooter(lane: SimulationLane): { text: string; bad: boolean } {
  if (lane.error) return { text: lane.error, bad: true };
  if (lane.verdict) return { text: lane.verdict.reason, bad: lane.verdict.outcome !== 'pass' };
  if (lane.status === 'running') return { text: `Turn ${lane.turns.filter(turn => turn.role === 'user').length} of ${lane.scenario.maxTurns}`, bad: false };
  return { text: lane.status === 'stopped' ? 'Stopped before it finished.' : 'Waiting for a free slot.', bad: false };
}

export function SimulationsView(props: SimulationsViewProps) {
  // A delayed RPC for another agent/project must not replace this target's
  // history, busy state or results. Each target owns its request lifetime.
  return <AgentSimulations key={JSON.stringify([props.pluginId, props.projectId, props.path])} {...props} />;
}

function AgentSimulations(props: SimulationsViewProps) {
  const resultsSplit = useStudioSplit({ storageKey: `salesforce:studio:simulation-results:${props.projectId ?? 'draft'}`, initial: 30, breakpoint: 460, stack: false, minPane: 170 });
  const { pluginId, projectId, threadId, path, source, dirty, visible, focus, onFocusHandled, onAskAgent, pollMs = 2000 } = props;
  const call = props.call ?? callPluginRpc;
  const [batches, setBatches] = useState<SimulationBatch[]>([]);
  const [batch, setBatch] = useState<SimulationBatch | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [laneId, setLaneId] = useState<string | null>(null);
  const [view, setView] = useState<'scenarios' | 'results'>('scenarios');
  const [activeScenario, setActiveScenario] = useState(LAB_SCENARIOS[0]!.name);
  const [presets, setPresets] = useState<string[]>(LAB_SCENARIOS.map(row => row.name));
  const [scenarios, setScenarios] = useState(() => LAB_SCENARIOS.map(row => ({ key: row.name, name: row.name, ...row.scenario })));
  const [contextPresets, setContextPresets] = useState<ContextPreset[]>([]);
  const [contextPreset, setContextPreset] = useState('');
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextRevision, setContextRevision] = useState(0);
  const nextScenario = useRef(0);
  const [repeats, setRepeats] = useState(1);
  const [parallel, setParallel] = useState(4);
  const [engine, setEngine] = useState<LabEngine>('preview');
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = useRef<HTMLDetailsElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const close = (event: Event) => { if (settings.current && !settings.current.contains(event.target as Node)) settings.current.open = false; };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('focusin', close, true);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('focusin', close, true); };
  }, []);
  const selected = useRef<string | null>(null);
  selected.current = selectedId;

  const rpc = useCallback(async (method: string, args: Record<string, unknown> = {}): Promise<Reply> => {
    const reply = await call(pluginId, method, { ...(projectId ? { projectId } : {}), ...args }) as Reply | null;
    return reply ?? { ok: false, error: 'No response.' };
  }, [call, pluginId, projectId]);

  useEffect(() => {
    if (!visible || !path) return;
    let cancelled = false;
    void rpc('agentPreview.presets.list', { path }).then(reply => {
      if (cancelled) return;
      if (reply.ok === false) { setContextError(reply.error || 'Could not load context presets.'); return; }
      setContextError(null);
      setContextPresets((reply.presets as ContextPreset[] | undefined) ?? []);
    }).catch(err => { if (!cancelled) setContextError(String(err?.message ?? err)); });
    return () => { cancelled = true; };
  }, [visible, path, rpc, contextRevision]);
  useRealtime(CONTEXT_CHANGED_CHANNEL, payload => {
    if ((payload as { projectId?: string })?.projectId !== projectId) return;
    setContextPreset(''); setContextPresets([]); setContextRevision(v => v + 1);
  });
  useRealtime(CONTEXT_PRESETS_CHANGED, payload => {
    if ((payload as { projectId?: string })?.projectId === projectId) setContextRevision(v => v + 1);
  });

  const loadBatch = useCallback(async (id: string) => {
    const reply = await rpc(SIMULATION_RPC.get, { batchId: id });
    if (!alive.current || selected.current !== id) return;
    if (reply.ok === false) { setError(reply.error || 'Could not read the simulation batch.'); return; }
    setBatch(reply.batch as SimulationBatch);
  }, [rpc]);

  const loadList = useCallback(async (pick?: string) => {
    const reply = await rpc(SIMULATION_RPC.list, path ? { agentPath: path } : {});
    if (!alive.current) return;
    if (reply.ok === false) { setError(reply.error || 'Could not list simulation batches.'); return; }
    const rows = (reply.batches as SimulationBatch[] | undefined) ?? [];
    setBatches(rows);
    // Project-wide realtime messages also announce other agents' batches.
    // Only select one that belongs to this agent's filtered history.
    const requested = pick && rows.some(row => row.id === pick) ? pick : undefined;
    const next = requested ?? selected.current ?? rows[0]?.id ?? null;
    if (next !== selected.current) { setSelectedId(next); setLaneId(null); if (next) setView('results'); }
    selected.current = next;
    if (next) await loadBatch(next); else setBatch(null);
  }, [loadBatch, path, rpc]);

  useEffect(() => { if (visible) void loadList().catch(err => alive.current && setError(String(err?.message ?? err))); }, [visible, loadList]);
  useEffect(() => {
    if (!focus) return;
    setView('results');
    void loadList(focus.batchId).catch(err => alive.current && setError(String(err?.message ?? err)));
    onFocusHandled?.(focus.seq);
  }, [focus, loadList, onFocusHandled]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const row = payload as { kind?: string; projectId?: string; batchId?: string } | null;
    if (!row || row.kind !== SIMULATIONS_CHANGED_KIND || (row.projectId && row.projectId !== projectId) || !visible) return;
    // A batch the agent just started shows up in the list; the one on screen refreshes.
    if (row.batchId && row.batchId === selected.current) void loadBatch(row.batchId).catch(() => undefined);
    else if (row.batchId && !batches.some(b => b.id === row.batchId)) void loadList(row.batchId).catch(() => undefined);
  });
  // Reconcile after missed realtime messages while the batch on screen runs.
  const running = batch?.status === 'running';
  useEffect(() => {
    if (!visible || !running || !selectedId) return;
    const timer = setInterval(() => void loadBatch(selectedId).catch(() => undefined), pollMs);
    return () => clearInterval(timer);
  }, [visible, running, selectedId, loadBatch, pollMs]);
  // A finished batch updates its row in the history.
  useEffect(() => {
    if (batch && isBatchDone(batch.status)) setBatches(rows => rows.map(row => row.id === batch.id ? { ...row, status: batch.status, counts: batch.counts } : row));
  }, [batch]);

  const lanes = presets.length * repeats;
  const start = async () => {
    if (!path) return;
    setBusy('start'); setError(null);
    try {
      const selectedScenarios: SimulationScenarioInput[] = scenarios.filter(row => presets.includes(row.key)).map(({ key: _key, ...row }) => row);
      parseSimulationRequest({ scenarios: selectedScenarios, repeats, parallel, engine });
      const preset = contextPresets.find(p => p.id === contextPreset);
      if (contextPreset && !preset) throw Error('The selected context preset is unavailable. Select it again.');
      const contextVariables = parsePreviewContext(preset?.values);
      const reply = await rpc(SIMULATION_RPC.start, { agentPath: path, source, scenarios: selectedScenarios, repeats, parallel, engine, contextVariables, startedByUser: true, ...(threadId ? { threadId } : {}) });
      if (!alive.current) return;
      if (reply.ok === false) { setError(reply.error || 'The simulation could not start.'); return; }
      const started = reply.batch as SimulationBatch;
      setBatch(started); setView('results');
      await loadList(started.id);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (alive.current) setBusy(null); }
  };
  const stop = async () => {
    if (!batch) return;
    setBusy('stop');
    try {
      const reply = await rpc(SIMULATION_RPC.stop, { batchId: batch.id });
      if (!alive.current) return;
      if (reply.ok === false) setError(reply.error || 'The batch could not stop.'); else setBatch(reply.batch as SimulationBatch);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (alive.current) setBusy(null); }
  };
  const pickBatch = (id: string) => { setSelectedId(id); selected.current = id; setLaneId(null); void loadBatch(id).catch(() => undefined); };
  const editScenario = (key: string, patch: Partial<SimulationScenarioInput>) => setScenarios(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row));
  const addScenario = () => {
    const key = `custom-${++nextScenario.current}`;
    setScenarios(rows => [...rows, { key, name: 'Custom scenario', persona: '', goal: '', opening: '', criteria: '', maxTurns: 4 }]);
    setPresets(rows => [...rows, key]); setActiveScenario(key);
  };
  const reuseScenarios = () => {
    if (!batch) return;
    const unique = [...new Map(batch.lanes.map(lane => [JSON.stringify([lane.name, lane.scenario]), { name: lane.name, ...lane.scenario }])).values()];
    const rows = unique.map((row, i) => ({ ...row, key: `reused-${i}` }));
    setScenarios(rows); setPresets(rows.map(row => row.key)); setActiveScenario(rows[0]?.key ?? ''); setView('scenarios'); setEngine(batch.engine); setRepeats(Math.max(1, ...batch.lanes.map(l => l.repeat))); setParallel(batch.parallel);
  };
  const togglePreset = (name: string) => setPresets(current => current.includes(name) ? current.filter(row => row !== name) : [...current, name]);

  if (!path) return <div className="sf-tp-empty">Open an agent file to simulate conversations with it.</div>;
  const lane = batch?.lanes.find(row => row.id === laneId) ?? null;
  const counts = batch?.counts;
  const finished = counts ? counts.pass + counts.fail + counts.inconclusive + counts.error + counts.stopped : 0;
  const notPassing = counts ? counts.fail + counts.inconclusive + counts.error : 0;

  return <div className="sf-sim" data-testid="studio-simulations">
    <style>{SIMULATION_STYLES}</style>
    <header className="sf-sim-heading">
      <div><h2>Simulations</h2><p>Test customer journeys against your agent.</p></div>
      <details ref={settings} className="sf-sim-settings" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation(); } }}>
        <summary><SlidersHorizontal size={14} aria-hidden="true" />Run settings</summary>
        <div className="sf-sim-settings-body" role="group" aria-label="Run settings">
          <label>Engine<select value={engine} disabled={running || busy !== null} onChange={event => setEngine(event.target.value as LabEngine)} aria-label="Engine"><option value="preview">Simulate</option><option value="rehearsal">Rehearse</option></select></label>
          <label>In parallel<select value={parallel} disabled={running || busy !== null} onChange={event => setParallel(Number(event.target.value))} aria-label="Parallel conversations">{[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>Repeats<select value={repeats} disabled={running || busy !== null} onChange={event => setRepeats(Number(event.target.value))} aria-label="Repeats">{Array.from({ length: SIMULATION_LIMITS.repeats }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}×</option>)}</select></label>
          <label>Context preset<select aria-label="Simulation context preset" value={contextPreset} disabled={running || busy !== null} onChange={event => setContextPreset(event.target.value)}><option value="">Agent defaults</option>{contextPresets.map(p => <option key={p.id} value={p.id}>{p.name} · revision {p.revision}</option>)}</select></label>
          {contextError && <p role="status">{contextError}</p>}
          <p>Create context presets in Preview → Context. These values apply to every conversation in this batch.</p>
        </div>
      </details>
      {running ? <button type="button" className="sf-tp-btn sf-sim-run" disabled={busy !== null} onClick={() => void stop()}>{busy === 'stop' ? 'Stopping…' : 'Stop'}</button>
        : <button type="button" className="sf-tp-btn is-primary sf-sim-run" disabled={busy !== null || !lanes || lanes > SIMULATION_LIMITS.lanes || !source.trim()} onClick={() => void start()}><Play size={13} aria-hidden="true" />{busy === 'start' ? 'Starting…' : `Run ${lanes} conversation${lanes === 1 ? '' : 's'}`}</button>}
    </header>
    <div className="sf-sim-navigation">
      <div role="group" aria-label="Simulation views"><button type="button" aria-pressed={view === 'scenarios'} onClick={() => setView('scenarios')}>Scenarios <span>{scenarios.length}</span></button><button type="button" aria-pressed={view === 'results'} onClick={() => setView('results')}>Results <span>{batch ? `${finished}/${batch.counts.total}` : '0'}</span></button></div>
      <span className="sf-sim-run-meta">{engine === 'preview' ? 'Simulate' : 'Rehearse'} · {parallel} in parallel · {repeats} {repeats === 1 ? 'repeat' : 'repeats'}</span>
    </div>
    <div hidden={view !== 'scenarios'}>
      <SimulationScenarios storageKey={`salesforce:studio:simulation-scenarios:${projectId ?? 'draft'}`} scenarios={scenarios} included={presets} activeKey={activeScenario} attention={new Set(batch?.lanes.filter(row => ['fail', 'inconclusive', 'error'].includes(row.status)).map(row => row.name))} disabled={running || busy !== null}
        onSelect={setActiveScenario} onToggle={togglePreset} onEdit={editScenario} onAdd={addScenario} onRemove={key => { setScenarios(rows => rows.filter(row => row.key !== key)); setPresets(rows => rows.filter(row => row !== key)); }} />
      {batch && <button type="button" className="sf-tp-btn sf-sim-reuse" disabled={running || busy !== null} onClick={reuseScenarios}>Use scenarios from this batch</button>}
    </div>
    <p className="sf-tp-foot">An AI customer plays each scenario, {engine === 'preview' ? 'the agent answers in Simulate (actions are simulated)' : 'an AI approximation of the agent answers'}, and an AI judge grades the transcript. Runs the editor source{dirty ? ', including unsaved changes' : ''}, {parallel} at a time. Verdicts are AI opinions, not release evidence.</p>
    {lanes > SIMULATION_LIMITS.lanes && <p role="alert">Choose at most {SIMULATION_LIMITS.lanes} conversations. Reduce scenarios or repeats.</p>}
    {error && <div className="sf-tp-message is-error" role="alert">{error}</div>}
    <div className="sf-sim-results" hidden={view !== 'results'}>
    {batch && counts && <div className="sf-tp-summary" data-testid="simulation-summary">
      <span className="sf-tp-score" aria-label={`${counts.pass} of ${counts.total} pass`}>{counts.pass}/{counts.total}</span>
      <span className="sf-tp-passbar" aria-hidden="true"><i className="is-pass" style={{ width: `${(counts.pass / Math.max(1, counts.total)) * 100}%` }} /><i className="is-fail" style={{ width: `${(notPassing / Math.max(1, counts.total)) * 100}%` }} /></span>
      <span className="sf-tp-chip">{BATCH_LABEL[batch.status]}{running ? ` · ${finished}/${counts.total}` : ''}</span>
      <span className="sf-tp-sub">{batch.engine === 'preview' ? 'Simulate' : 'Rehearse'}{batch.orgAlias ? ` · ${batch.orgAlias}` : ''}{batch.candidate ? ' · draft' : ''}{batch.startedBy === 'thread' ? ' · started by the agent' : ''}</span>
      <span className="sf-tp-spacer" />
      {batches.length > 1 && <select aria-label="Simulation batch" value={batch.id} onChange={event => pickBatch(event.currentTarget.value)}>
        {batches.map(row => <option key={row.id} value={row.id}>{new Date(row.startedAt).toLocaleString()} · {row.counts.pass}/{row.counts.total} · {BATCH_LABEL[row.status]}</option>)}
      </select>}
      {onAskAgent && isBatchDone(batch.status) && notPassing > 0 && <button type="button" className="sf-tp-btn is-primary" onClick={() => onAskAgent(improvePrompt(batch))}>Ask the agent to improve</button>}
    </div>}
    <div className="sf-sim-results-workspace" ref={resultsSplit.ref} style={resultsSplit.style}>
    {batch && <div className="sf-sim-lanes" role="list" aria-label="Conversations">
      {batch.lanes.map(row => {
        const footer = laneFooter(row);
        return <div key={row.id} role="listitem"><button type="button" className={`sf-sim-lane is-${row.status}`} aria-pressed={row.id === laneId} onClick={() => setLaneId(current => current === row.id ? null : row.id)}>
          <header><b>{row.name}{row.repeat > 1 ? ` #${row.repeat}` : ''}</b><StatusChip status={row.status} /></header>
          <div className="sf-sim-persona">{row.scenario.persona}</div>
          <div className="sf-sim-mini">{row.turns.slice(-2).map((turn, index) => <p key={index} className={turn.role === 'user' ? 'is-user' : undefined}>{turn.role === 'user' ? 'Customer: ' : 'Agent: '}{turn.text}</p>)}</div>
          <footer className={footer.bad ? 'is-bad' : undefined}>{footer.text}</footer>
        </button></div>;
      })}
    </div>}
    {batch && resultsSplit.divider('Resize conversations and result details')}
    {lane && <section className="sf-sim-detail" aria-label={`Conversation ${lane.name}`}>
      <h3>{lane.name}{lane.repeat > 1 ? ` #${lane.repeat}` : ''} <StatusChip status={lane.status} /></h3>
      <div className="sf-tp-sub"><b>Goal:</b> {lane.scenario.goal}<br /><b>Criteria:</b> {lane.scenario.criteria}</div>
      {(lane.verdict || lane.error) && <div className={`sf-sim-verdict is-${lane.error ? 'error' : lane.verdict!.outcome}`}>
        <strong>{lane.error ? 'Error' : `Judge: ${STATUS_LABEL[lane.verdict!.outcome]}`}</strong> {lane.error ?? lane.verdict!.reason}
        {lane.verdict && <ul>{lane.verdict.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>}
      </div>}
      <div className="sf-sim-turns">
        {lane.turns.map((turn, index) => <div key={index} className={`sf-sim-turn${turn.role === 'user' ? ' is-user' : ''}`}>
          <small>{turn.role === 'user' ? 'AI customer' : 'Agent'}{turn.latencyMs ? ` · ${(turn.latencyMs / 1000).toFixed(1)} s` : ''}</small>{turn.text}
        </div>)}
        {!lane.turns.length && <div className="sf-tp-empty">No turns yet.</div>}
      </div>
    </section>}
    {batch && !lane && <div className="sf-sim-detail sf-sim-placeholder"><MessageSquare size={24} aria-hidden="true" /><h3>Explore a conversation</h3><p>Select a result to read its transcript and judge’s evidence.</p></div>}
    </div>
    {batch && <button type="button" className="sf-tp-btn sf-sim-reuse" disabled={running || busy !== null} onClick={reuseScenarios}>Use scenarios from this batch</button>}
    <SelfHealingPanel key={`${projectId}:${path}`} path={path} source={source} batch={batch} visible={visible} rpc={rpc} onAskAgent={onAskAgent} />
    </div>
    {!batch && !error && <div className="sf-tp-empty">No simulations yet for this agent. Run a batch, or ask the thread agent to run one.</div>}
  </div>;
}
