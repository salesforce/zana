import { useEffect, useRef, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { DEFAULT_LAB_MODEL, LAB_SCENARIOS, parseLabScenario, type LabEngine, type LabScenario, type LabSnapshot, type LabVerdict } from '../../lib/agentforce-lab-contract.js';
import { Bot, FlaskConical } from './components/icons.js';

export function AgentforceLabPanel(props: { pluginId: string; projectId?: string; source: string; mode: 'rehearse' | 'test'; fileLabel: string; hidden?: boolean }) {
  const [engine, setEngine] = useState<LabEngine>('preview');
  const [model, setModel] = useState(DEFAULT_LAB_MODEL);
  const [scenario, setScenario] = useState<LabScenario>({ ...LAB_SCENARIOS[0].scenario });
  const [session, setSession] = useState<LabSnapshot | null>(null);
  const [verdict, setVerdict] = useState<LabVerdict | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready when you are');
  const [error, setError] = useState('');
  const [runSource, setRunSource] = useState('');
  const [setupOpen, setSetupOpen] = useState(true);
  const active = useRef<LabSnapshot | null>(null);
  const locked = useRef(false);
  const cancelled = useRef(false);
  const alive = useRef(true);
  const transcript = useRef<HTMLDivElement>(null);
  const runDetails = useRef<{ source: string; file: string; scenario?: LabScenario } | null>(null);

  const rpc = async <T,>(method: string, args: Record<string, unknown>): Promise<T> => {
    const result = await callPluginRpc(props.pluginId, `agentLab.${method}`, { projectId: props.projectId, ...args }) as { ok: boolean; data?: T; error?: string };
    if (!result?.ok || result.data === undefined) throw new Error(result?.error || 'The rehearsal could not complete.');
    return result.data;
  };
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

  async function perform(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    cancelled.current = false;
    setBusy(true); setError('');
    try { await work(); }
    catch (err) {
      if (alive.current && !cancelled.current) { setError(err instanceof Error ? err.message : String(err)); setStatus('Run incomplete'); }
      if (active.current && !active.current.closed) {
        try { update(await rpc<LabSnapshot>('end', { id: active.current.id })); } catch { /* Original error stays visible. */ }
      }
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  async function begin(test: boolean) {
    if (active.current && !active.current.closed) await rpc('end', { id: active.current.id });
    setVerdict(null); setSession(null); active.current = null;
    const selected = test ? parseLabScenario(scenario) : undefined;
    if (selected) setSetupOpen(false);
    runDetails.current = { source: props.source, file: props.fileLabel, scenario: selected };
    setRunSource(props.source);
    setStatus(engine === 'preview' ? 'Compiling draft in Salesforce…' : 'Preparing AI rehearsal…');
    const started = await rpc<LabSnapshot>('start', { engine, model, source: props.source, ...(selected ? { scenario: selected } : {}) });
    update(started);
    if (cancelled.current || !alive.current) { update(await rpc<LabSnapshot>('end', { id: started.id })); return; }
    if (!selected) { setStatus('Conversation ready'); return; }
    let text = selected.opening;
    for (let i = 0; i < selected.maxTurns; i++) {
      if (cancelled.current || !alive.current) return;
      setStatus(`Turn ${i + 1} of ${selected.maxTurns} · Agent replying…`);
      const next = await rpc<LabSnapshot>('send', { id: started.id, text });
      if (cancelled.current || !alive.current) return;
      update(next);
      if (i + 1 < selected.maxTurns) {
        setStatus(`Turn ${i + 2} of ${selected.maxTurns} · Customer thinking…`);
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
    setStatus('Agent replying…');
    const result = await rpc<LabSnapshot>('send', { id: active.current.id, text });
    if (cancelled.current || !alive.current) return;
    update(result); setDraft(''); setStatus('Your turn');
  }
  function exportRun() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...runDetails.current, session, status, error: error || undefined, verdict, advisory: true }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'agentforce-rehearsal.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const running = Boolean(session && !session.closed);
  const testing = props.mode === 'test';
  const stale = Boolean(session && props.source !== runSource);
  return <aside className="af-lab" hidden={props.hidden} aria-label="Agentforce rehearsal" data-testid="agentforce-lab">
    <header className="af-lab-heading"><span className="af-icon">{testing ? <FlaskConical /> : <Bot />}</span><div><h2>{testing ? 'Test with a customer' : 'Meet your agent'}</h2><p>{testing ? 'A scenario. A conversation. Evidence.' : 'Turn your script into a conversation.'}</p></div></header>
    <div className="af-lab-scroll" ref={transcript}>
      <div className="af-engine" role="group" aria-label="Rehearsal engine">
        <button type="button" aria-pressed={engine === 'preview'} disabled={busy || running} onClick={() => setEngine('preview')}><strong>Salesforce Preview</strong><span>Real runtime · simulated actions</span></button>
        <button type="button" aria-pressed={engine === 'rehearsal'} disabled={busy || running} onClick={() => setEngine('rehearsal')}><strong>AI rehearsal</strong><span>Script interpretation · no actions</span></button>
      </div>
      <p className="af-caption">{engine === 'preview' ? 'Tests this editor draft through the Preview API. Nothing is published.' : 'An AI model plays your script. This does not validate Agentforce runtime behavior.'}</p>
      {testing && <details className="af-scenario-details" open={setupOpen} onToggle={e => setSetupOpen(e.currentTarget.open)}><summary>Scenario setup <span>{scenario.maxTurns} turns</span></summary><fieldset className="af-scenario" disabled={busy || running}>
        <legend>SCENARIO</legend>
        <div className="af-presets">{LAB_SCENARIOS.map(p => <button type="button" key={p.name} onClick={() => setScenario({ ...p.scenario })}>{p.name}</button>)}</div>
        <label>Customer persona<textarea rows={2} value={scenario.persona} maxLength={2000} onChange={e => setScenario({ ...scenario, persona: e.target.value })} /></label>
        <label>Customer goal<textarea rows={2} value={scenario.goal} maxLength={2000} onChange={e => setScenario({ ...scenario, goal: e.target.value })} /></label>
        <label>Opening message<input value={scenario.opening} maxLength={4000} onChange={e => setScenario({ ...scenario, opening: e.target.value })} /></label>
        <label>Success criteria<textarea rows={2} value={scenario.criteria} maxLength={4000} onChange={e => setScenario({ ...scenario, criteria: e.target.value })} /></label>
        <label className="af-turn-limit">Conversation budget<select value={scenario.maxTurns} onChange={e => setScenario({ ...scenario, maxTurns: Number(e.target.value) })}>{[1,2,3,4,5,6,7,8].map(n => <option value={n} key={n}>{n} turn{n > 1 ? 's' : ''}</option>)}</select></label>
      </fieldset></details>}
      {(testing || engine === 'rehearsal') && <details className="af-model"><summary>AI model & usage</summary><label>Salesforce model API name<input value={model} disabled={busy || running} onChange={e => setModel(e.target.value)} maxLength={160} /></label><p>Uses the selected org’s Models API and consumes Einstein requests. The org needs access to this model. AI judgments are advisory.</p></details>}
      <div className="af-run-actions"><button className="af-primary" type="button" disabled={busy || !props.source.trim()} onClick={() => void perform(() => begin(testing))}>{busy ? 'Running…' : testing ? 'Run AI role-play' : running ? 'New conversation' : 'Start conversation'}<span aria-hidden="true">↗</span></button>{(busy || running) && <button type="button" className="af-secondary" onClick={() => void stop()}>Stop</button>}</div>
      {stale && <p className="af-notice">Your script changed. This conversation uses the earlier snapshot. Start a new run to test your edits.</p>}
      {error && <div className="af-error" role="alert">{error}</div>}
      <div className="af-conversation-head"><span className={busy ? 'af-status is-busy' : 'af-status'} aria-live="polite">{status}</span>{session && <button type="button" className="af-text-button" onClick={exportRun}>Export run</button>}</div>
      {session && <div className="af-run-meta"><span>{session.engine === 'preview' ? 'Preview API' : 'AI approximation'}</span><span>{session.orgAlias}</span><span title={session.sourceHash}>Draft {session.sourceHash.slice(0, 7)}</span></div>}
      <div className="af-transcript" role="log" aria-label="Rehearsal conversation" data-testid="agentforce-lab-transcript">
        {!session?.turns.length && <div className="af-welcome"><span className="af-welcome-orbit"><Bot /></span><h3>{testing ? 'Put your agent to the test' : 'Every great agent starts with a conversation'}</h3><p>{testing ? 'Choose a customer and a goal. AI will play the customer, then review the conversation against your criteria.' : 'Ask a real question, follow up, and see how your agent handles the conversation.'}</p><span className="af-welcome-tag">{props.fileLabel || 'Current draft'}</span></div>}
        {session?.turns.map((turn, index) => <article key={index} className={`af-message is-${turn.role}`}><div className="af-message-meta"><strong>{turn.role === 'agent' ? 'Agentforce' : testing ? 'AI customer' : 'You'}</strong>{turn.latencyMs !== undefined && <span>{(turn.latencyMs / 1000).toFixed(1)}s</span>}</div><div className="af-message-text">{turn.text}</div>{turn.planId && <details className="af-plan"><summary>Runtime evidence</summary><span>Plan {turn.planId}</span></details>}</article>)}
      </div>
      {verdict && <section className={`af-verdict is-${verdict.outcome}`} aria-label="AI evaluation"><div><strong>{verdict.outcome === 'pass' ? 'Criteria met' : verdict.outcome === 'fail' ? 'Needs attention' : 'More evidence needed'}</strong><span>AI assessment</span></div><p>{verdict.reason}</p><ul>{verdict.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul><small>Advisory result · not release approval</small></section>}
    </div>
    {!testing && <form className="af-composer" onSubmit={e => { e.preventDefault(); void perform(send); }}><input aria-label="Rehearsal message" placeholder={running ? 'Ask your agent something…' : 'Start a conversation to try your agent'} disabled={!running || busy} value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} /><button type="submit" aria-label="Send rehearsal message" disabled={!running || busy || !draft.trim()}>↑</button></form>}
  </aside>;
}
