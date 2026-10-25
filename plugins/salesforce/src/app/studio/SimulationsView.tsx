import { useCallback, useEffect, useRef, useState } from 'react';
import { callPluginRpc, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
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

const STYLES = `
.sf-sim { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.sf-sim-setup { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; padding: 8px 10px; border: 1px solid var(--sf-border); border-radius: 8px; }
.sf-sim-setup label { display: inline-flex; gap: 4px; align-items: center; color: var(--sf-text); }
.sf-sim-setup select { font: inherit; color: var(--sf-text); background: var(--sf-sunken); border: 1px solid var(--sf-border); border-radius: 6px; padding: 1px 4px; }
.sf-sim-lanes { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
.sf-sim-lanes > [role="listitem"] { min-width: 0; display: flex; }
.sf-sim-lanes > [role="listitem"] > button { width: 100%; }
.sf-sim-lane { border: 1px solid var(--sf-border); border-radius: 8px; display: flex; flex-direction: column; text-align: left; font: inherit; color: inherit; background: transparent; padding: 0; cursor: pointer; overflow: hidden; min-width: 0; }
.sf-sim-lane:hover { background: var(--sf-soft); }
.sf-sim-lane[aria-pressed="true"] { outline: 2px solid var(--sf-accent); outline-offset: -1px; }
.sf-sim-lane.is-running { border-color: var(--sf-accent); }
.sf-sim-lane.is-pass { border-color: var(--sf-success); }
.sf-sim-lane.is-fail, .sf-sim-lane.is-error { border-color: var(--sf-danger); }
.sf-sim-lane header { display: flex; gap: 6px; align-items: flex-start; padding: 6px 8px 2px; }
.sf-sim-lane header b { flex: 1; overflow-wrap: anywhere; }
.sf-sim-persona { padding: 0 8px 6px; color: var(--sf-muted); font-size: 11px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sf-sim-mini { border-top: 1px solid var(--sf-border); padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; min-height: 52px; font-size: 11px; }
.sf-sim-mini p { margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.sf-sim-mini .is-user { color: var(--sf-muted); }
.sf-sim-lane footer { border-top: 1px solid var(--sf-border); padding: 5px 8px; font-size: 11px; color: var(--sf-muted); overflow-wrap: anywhere; }
.sf-sim-lane footer.is-bad { color: var(--sf-danger); }
.sf-sim-chip.is-running { color: var(--sf-accent); border-color: var(--sf-accent); }
.sf-sim-chip.is-error { border-color: var(--sf-danger); color: var(--sf-danger); }
.sf-sim-detail { border: 1px solid var(--sf-border); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }
.sf-sim-detail h3 { margin: 0; font-size: 12px; }
.sf-sim-turns { display: flex; flex-direction: column; gap: 6px; }
.sf-sim-turn { max-width: 88%; padding: 5px 8px; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--sf-elevated); }
.sf-sim-turn.is-user { align-self: flex-end; background: color-mix(in srgb, var(--sf-accent) 14%, transparent); }
.sf-sim-turn small { display: block; color: var(--sf-muted); font-size: 10px; }
.sf-sim-verdict { padding: 6px 8px; border-radius: 6px; border: 1px solid var(--sf-border); overflow-wrap: anywhere; }
.sf-sim-verdict.is-pass { border-color: var(--sf-success); }
.sf-sim-verdict.is-fail, .sf-sim-verdict.is-error { border-color: var(--sf-danger); background: color-mix(in srgb, var(--sf-danger) 8%, transparent); }
.sf-sim-verdict ul { margin: 4px 0 0; padding-left: 16px; }
`;

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
  const { pluginId, projectId, threadId, path, source, dirty, visible, focus, onFocusHandled, onAskAgent, pollMs = 2000 } = props;
  const call = props.call ?? callPluginRpc;
  const [batches, setBatches] = useState<SimulationBatch[]>([]);
  const [batch, setBatch] = useState<SimulationBatch | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [laneId, setLaneId] = useState<string | null>(null);
  const [presets, setPresets] = useState<string[]>(LAB_SCENARIOS.map(row => row.name));
  const [scenarios, setScenarios] = useState(() => LAB_SCENARIOS.map(row => ({ key: row.name, name: row.name, ...row.scenario })));
  const [contextPresets, setContextPresets] = useState<ContextPreset[]>([]);
  const [contextPreset, setContextPreset] = useState('');
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextRevision, setContextRevision] = useState(0);
  const nextScenario = useRef(0);
  const [repeats, setRepeats] = useState(1);
  const [engine, setEngine] = useState<LabEngine>('preview');
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
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
    if (next !== selected.current) { setSelectedId(next); setLaneId(null); }
    selected.current = next;
    if (next) await loadBatch(next); else setBatch(null);
  }, [loadBatch, path, rpc]);

  useEffect(() => { if (visible) void loadList().catch(err => alive.current && setError(String(err?.message ?? err))); }, [visible, loadList]);
  useEffect(() => {
    if (!focus) return;
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
      parseSimulationRequest({ scenarios: selectedScenarios, repeats, engine });
      const preset = contextPresets.find(p => p.id === contextPreset);
      if (contextPreset && !preset) throw Error('The selected context preset is unavailable. Select it again.');
      const contextVariables = parsePreviewContext(preset?.values);
      const reply = await rpc(SIMULATION_RPC.start, { agentPath: path, source, scenarios: selectedScenarios, repeats, engine, contextVariables, startedByUser: true, ...(threadId ? { threadId } : {}) });
      if (!alive.current) return;
      if (reply.ok === false) { setError(reply.error || 'The simulation could not start.'); return; }
      const started = reply.batch as SimulationBatch;
      setBatch(started);
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
    setPresets(rows => [...rows, key]);
  };
  const reuseScenarios = () => {
    if (!batch) return;
    const unique = [...new Map(batch.lanes.map(lane => [JSON.stringify([lane.name, lane.scenario]), { name: lane.name, ...lane.scenario }])).values()];
    const rows = unique.map((row, i) => ({ ...row, key: `reused-${i}` }));
    setScenarios(rows); setPresets(rows.map(row => row.key)); setEngine(batch.engine); setRepeats(Math.max(1, ...batch.lanes.map(l => l.repeat)));
  };
  const togglePreset = (name: string) => setPresets(current => current.includes(name) ? current.filter(row => row !== name) : [...current, name]);

  if (!path) return <div className="sf-tp-empty">Open an agent file to simulate conversations with it.</div>;
  const lane = batch?.lanes.find(row => row.id === laneId) ?? null;
  const counts = batch?.counts;
  const finished = counts ? counts.pass + counts.fail + counts.inconclusive + counts.error : 0;
  const notPassing = counts ? counts.fail + counts.inconclusive + counts.error : 0;

  return <div className="sf-sim" data-testid="studio-simulations">
    <style>{STYLES}</style>
    <div className="sf-sim-setup" role="group" aria-label="New simulation batch">
      {scenarios.map(row => <label key={row.key} title={row.persona}>
        <input type="checkbox" checked={presets.includes(row.key)} disabled={running || busy !== null} onChange={() => togglePreset(row.key)} />{row.name}
      </label>)}
      <label>Repeats <select value={repeats} disabled={running || busy !== null} onChange={event => setRepeats(Number(event.currentTarget.value))} aria-label="Repeats">
        {Array.from({ length: SIMULATION_LIMITS.repeats }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}×</option>)}
      </select></label>
      <label>Engine <select value={engine} disabled={running || busy !== null} onChange={event => setEngine(event.currentTarget.value as LabEngine)} aria-label="Engine">
        <option value="preview">Simulate</option><option value="rehearsal">Rehearse</option>
      </select></label>
      <span className="sf-tp-spacer" />
      {running
        ? <button type="button" className="sf-tp-btn" disabled={busy !== null} onClick={() => void stop()}>{busy === 'stop' ? 'Stopping…' : 'Stop'}</button>
        : <button type="button" className="sf-tp-btn is-primary" disabled={busy !== null || !lanes || lanes > SIMULATION_LIMITS.lanes || !source.trim()} onClick={() => void start()}>
          {busy === 'start' ? 'Starting…' : `Run ${lanes} conversation${lanes === 1 ? '' : 's'}`}
        </button>}
    </div>
    <details>
      <summary>Customize scenarios and context</summary>
      <div className="sf-tp-form">
        <label className="is-wide">Context preset<select aria-label="Simulation context preset" value={contextPreset} disabled={running || busy !== null} onChange={e => setContextPreset(e.currentTarget.value)}>
          <option value="">Agent defaults</option>
          {contextPresets.map(p => <option key={p.id} value={p.id}>{p.name} · revision {p.revision}</option>)}
        </select></label>
        {contextError && <p className="is-wide" role="status">{contextError}</p>}
        <p className="sf-tp-foot is-wide">Create context presets in Preview → Context. The selected values apply to every conversation in this batch.</p>
        {scenarios.map((row, i) => <fieldset key={row.key} className="is-wide sf-tp-form" disabled={running || busy !== null}>
          <legend>Scenario {i + 1}</legend>
          {(['name', 'persona', 'goal', 'opening', 'criteria'] as const).map(field => <label key={field} className={field === 'opening' || field === 'criteria' ? 'is-wide' : undefined}>
            {{ name: 'Name', persona: 'Customer persona', goal: 'Customer goal', opening: 'Opening message', criteria: 'Success criteria' }[field]}
            <textarea aria-label={`Scenario ${i + 1} ${field}`} value={row[field]} maxLength={field === 'name' ? 80 : field === 'persona' || field === 'goal' ? 2000 : 4000} rows={field === 'name' ? 1 : 2} onChange={e => editScenario(row.key, { [field]: e.currentTarget.value })} />
          </label>)}
          <label>Maximum turns<input aria-label={`Scenario ${i + 1} maximum turns`} type="number" min={1} max={8} value={row.maxTurns} onChange={e => editScenario(row.key, { maxTurns: Number(e.currentTarget.value) })} /></label>
          <button type="button" className="sf-tp-btn" onClick={() => { setScenarios(rows => rows.filter(r => r.key !== row.key)); setPresets(rows => rows.filter(k => k !== row.key)); }}>Remove scenario {i + 1}</button>
        </fieldset>)}
        <button type="button" className="sf-tp-btn" disabled={running || busy !== null || scenarios.length >= SIMULATION_LIMITS.lanes} onClick={addScenario}>Add scenario</button>
        {batch && <button type="button" className="sf-tp-btn" disabled={running || busy !== null} onClick={reuseScenarios}>Use scenarios from this batch</button>}
      </div>
    </details>
    <p className="sf-tp-foot">An AI customer plays each scenario, {engine === 'preview' ? 'the agent answers in Simulate (actions are simulated)' : 'an AI approximation of the agent answers'}, and an AI judge grades the transcript. Runs the editor source{dirty ? ', including unsaved changes' : ''}, {SIMULATION_LIMITS.parallel} at a time. Verdicts are AI opinions, not release evidence.</p>
    {lanes > SIMULATION_LIMITS.lanes && <p role="alert">Choose at most {SIMULATION_LIMITS.lanes} conversations. Reduce scenarios or repeats.</p>}
    {error && <div className="sf-tp-message is-error" role="alert">{error}</div>}
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
    {!batch && !error && <div className="sf-tp-empty">No simulations yet for this agent. Run a batch, or ask the thread agent to run one.</div>}
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
  </div>;
}
