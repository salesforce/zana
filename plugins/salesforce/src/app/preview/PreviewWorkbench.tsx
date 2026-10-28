import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { callPluginRpc, useRealtime } from '@zana-ai/zcc-plugin-sdk/app';
import { PREVIEW_ENGINES, STUDIO_CHANGED_CHANNEL, STUDIO_RPC, type ScenarioSuite, type StudioEngine, type TurnTrace } from '../../../lib/studio-contract.js';
import type { LabSnapshot } from '../../../lib/agentforce-lab-contract.js';
import {
  appendRun, caseFromRun, diffRuns, engineToLab, exportRunPayload,
  type RunRecord, type RunTurn
} from '../agentforce-preview-logic.js';
import { STUDIO_TOKENS } from '../studio/studio-tokens.js';
import { TRACE_PANEL_STYLES, TracePanel } from './TracePanel.js';
import { PREVIEW_SUITE_STYLES, PreviewSuite } from './PreviewSuite.js';
import { PREVIEW_CONTEXT_STYLES, PreviewContextEditor, PreviewContextSetup, PreviewContextTabs, usePreviewContext } from './PreviewContext.js';
import type { AppliedContextPreset, ContextPreset } from '../../../lib/preview-context-preset-contract.js';
import { parsePreviewContext, type PreviewContextVariable } from '../../../lib/preview-context.js';

export interface PreviewWorkbenchProps {
  pluginId: string;
  projectId?: string;
  /** Current editor source snapshot. */
  source: string;
  fileLabel: string;
  engine?: StudioEngine;
  onEngineChange?(engine: StudioEngine): void;
  onRevealSource?(path: string, line: number): void;
  /** Project-relative .agent path: enables trace-to-source, saved suites and Live. */
  path?: string;
  /** Live (CLI) preview target. */
  orgAlias?: string;
  threadId?: string;
  /** Called with the active run so the host can publish `lastRun` into the studio view. */
  onRunChange?(run: { runId: string; engine: StudioEngine; turn: number } | null): void;
  /** Controlled command from the host (`preview.start` / `preview.send`); each new `seq` runs once in the selected engine. */
  command?: PreviewCommand | null;
  /** Called once the command is taken, so the host can drop it and a remount never replays it. */
  onCommandHandled?(seq: number): void;
  /** The editor has unsaved changes: Live runs the saved file. */
  dirty?: boolean;
}

/** start/send drive a run; context (context.set) only fills the Context tab. preset is resolved by the host before it reaches the view. */
export interface PreviewCommand { seq: number; type: 'start' | 'send' | 'context'; text?: string; engine?: StudioEngine; contextVariables?: PreviewContextVariable[]; preset?: ContextPreset; merge?: boolean }

type SuiteEntry = ScenarioSuite & { sha256?: string };
/** A started run and the context it was started in, so it is ended against the same project, file and thread. */
type ActiveRun = { id: string; engine: StudioEngine; projectId?: string; path?: string; threadId?: string; orgAlias?: string };
type Rpc<T> = { ok?: boolean; error?: string; data?: T } & Record<string, unknown>;
const ENGINE_COPY: Record<StudioEngine, { title: string; hint: string }> = {
  rehearse: { title: 'Rehearse', hint: 'AI plays your script · no runtime' },
  simulate: { title: 'Simulate', hint: 'Salesforce Preview API · simulated actions' },
  live: { title: 'Live', hint: 'Real actions on the connected org' }
};

export const PREVIEW_WORKBENCH_STYLES = `
.sf-pw { display:flex; flex-direction:column; height:100%; min-height:0; background:var(--sf-bg); color:var(--sf-text); font-size:12px; }
.sf-pw button { font:inherit; color:inherit; }
.sf-pw-bar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:8px 10px; border-bottom:1px solid var(--sf-border); }
.sf-pw-seg { display:inline-flex; border:1px solid var(--sf-border); border-radius:8px; overflow:hidden; }
.sf-pw-seg button { border:0; background:transparent; padding:4px 10px; cursor:pointer; color:var(--sf-muted); }
.sf-pw-seg button[aria-pressed=true] { background:var(--sf-accent); color:var(--sf-bg); }
.sf-pw-seg button:disabled { opacity:.55; cursor:default; }
.sf-pw-btn { border:1px solid var(--sf-border); background:transparent; border-radius:6px; padding:4px 10px; cursor:pointer; }
.sf-pw-btn.is-primary { background:var(--sf-accent); color:var(--sf-bg); border-color:var(--sf-accent); }
.sf-pw-btn:disabled { opacity:.5; cursor:default; }
.sf-pw-btn:focus-visible, .sf-pw-seg button:focus-visible { outline:2px solid var(--sf-accent); outline-offset:2px; }
.sf-pw-spacer { flex:1; }
.sf-pw-hint { color:var(--sf-muted); font-size:11px; padding:4px 10px; }
.sf-pw-hint.is-warn { color:var(--sf-warn); }
.sf-pw-err { color:var(--sf-danger); padding:6px 10px; border-bottom:1px solid var(--sf-border); }
.sf-pw-log { flex:1; min-height:0; overflow:auto; padding:20px max(14px, calc((100% - 920px) / 2)); display:flex; flex-direction:column; gap:16px; }
.sf-pw-empty { margin:auto; text-align:center; color:var(--sf-muted); max-width:260px; }
.sf-pw-msg { display:flex; flex-direction:column; gap:6px; max-width:100%; min-width:0; flex-shrink:0; }
.sf-pw-msg.is-user { align-self:flex-end; align-items:flex-end; }
.sf-pw-bubble { border:1px solid var(--sf-border); border-radius:12px; padding:10px 14px; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; }
.sf-pw-msg.is-user .sf-pw-bubble { background:var(--sf-accent); color:var(--sf-bg); border-color:var(--sf-accent); }
.sf-pw-meta { display:flex; gap:8px; align-items:center; color:var(--sf-muted); font-size:10px; }
.sf-pw-link { border:0; background:transparent; color:var(--sf-accent); cursor:pointer; padding:0; font-size:10px; }
.sf-pw-composer { display:flex; gap:8px; padding:12px max(14px, calc((100% - 920px) / 2)); border-top:1px solid var(--sf-border); }
.sf-pw-composer input { flex:1; min-width:0; font:inherit; padding:6px 8px; border:1px solid var(--sf-border); border-radius:6px; background:transparent; color:var(--sf-text); }
.sf-pw-panel { border-top:1px solid var(--sf-border); padding:8px 10px; display:flex; flex-direction:column; gap:6px; }
.sf-pw-panel label { display:flex; flex-direction:column; gap:2px; color:var(--sf-muted); }
.sf-pw-panel input, .sf-pw-panel select { font:inherit; padding:4px 6px; border:1px solid var(--sf-border); border-radius:6px; background:transparent; color:var(--sf-text); }
.sf-pw-cmp { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.sf-pw-cmp > div { border:1px solid var(--sf-border); border-radius:6px; padding:4px 6px; overflow-wrap:anywhere; white-space:pre-wrap; }
.sf-pw-cmp > div.is-diff { border-color:var(--sf-warn); }
.sf-pw-cmp .sf-pw-meta { grid-column:1 / -1; }
/* The host chrome sets user-select:none; the conversation, traces, hints and errors are reading surfaces the user copies from. */
.sf-pw-log, .sf-pw-hint, .sf-pw-err, .sf-pw-cmp { user-select:text; -webkit-user-select:text; }
`;

function snapshotTurns(snapshot: LabSnapshot): RunTurn[] {
  return snapshot.turns.map(t => ({ role: t.role, text: t.text, ...(t.latencyMs !== undefined ? { latencyMs: t.latencyMs } : {}), ...(t.planId ? { planId: t.planId } : {}) }));
}
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const unavailable = (runId: string, reason: string, planId?: string): TurnTrace => ({ runId, turn: 0, ...(planId ? { planId } : {}), available: false, reason, steps: [] });
const LIVE_TRACE_REASON = 'Live runs do not return a planner trace here. Use Simulate to see how the agent decided.';

export function PreviewWorkbench(props: PreviewWorkbenchProps) {
  const { pluginId, projectId, path } = props;
  const context = usePreviewContext({ pluginId, projectId, path, source: props.source, orgAlias: props.orgAlias, scope: `${projectId ?? ''}:${path ?? ''}:${props.orgAlias ?? ''}` });
  const [runContext, setRunContext] = useState<PreviewContextVariable[]>([]);
  const [innerEngine, setInnerEngine] = useState<StudioEngine>(props.engine ?? 'simulate');
  // Rehearse is hidden for now: a stale request for it runs Simulate.
  const chosen = props.engine ?? innerEngine;
  const engine: StudioEngine = chosen === 'rehearse' ? 'simulate' : chosen;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<RunTurn[]>([]);
  const [traces, setTraces] = useState<Record<string, TurnTrace>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [tracing, setTracing] = useState<Record<number, boolean>>({});
  const [runPreset, setRunPreset] = useState<AppliedContextPreset | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runSource, setRunSource] = useState('');
  const [runEngine, setRunEngine] = useState<StudioEngine>(engine);
  const [suite, setSuite] = useState<SuiteEntry | null>(null);
  const [suiteBusy, setSuiteBusy] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveCriteria, setSaveCriteria] = useState('');
  const [compare, setCompare] = useState<[string, string] | null>(null);
  const alive = useRef(true);
  const active = useRef<ActiveRun | null>(null);
  // Bumped whenever the run is released, so a start that resolves afterwards knows it was superseded.
  const epoch = useRef(0);
  const locked = useRef(false);

  const rpc = useCallback(async <T,>(method: string, args: Record<string, unknown> = {}): Promise<Rpc<T>> => {
    const result = await callPluginRpc(pluginId, method, { ...(projectId ? { projectId } : {}), ...args }) as Rpc<T>;
    return result ?? { ok: false, error: 'No response.' };
  }, [pluginId, projectId]);

  const close = useCallback(async (run: ActiveRun): Promise<Rpc<unknown>> => {
    const live = run.engine === 'live';
    const result = await callPluginRpc(pluginId, live ? 'agentPreview.end' : 'agentLab.end', {
      ...(run.projectId ? { projectId: run.projectId } : {}),
      ...(live ? { sessionId: run.id, path: run.path, orgAlias: run.orgAlias, live: true, ...(run.threadId ? { threadId: run.threadId } : {}) } : { id: run.id })
    }) as Rpc<unknown>;
    return result ?? { ok: false, error: 'No response.' };
  }, [pluginId]);
  const release = useCallback(() => {
    epoch.current += 1;
    const current = active.current;
    active.current = null;
    setSessionId(null);
    if (current) void close(current).catch(() => undefined);
  }, [close]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // A run belongs to the file it started from: opening another file ends it, while saving a new draft keeps it.
  const shownPath = useRef(path);
  useEffect(() => {
    const previous = shownPath.current;
    shownPath.current = path;
    if (previous && previous !== path) release();
  }, [path, release]);
  // Switching project or unmounting ends the run.
  useEffect(() => release, [projectId, props.orgAlias, release]);

  // Keep a bounded history of runs (compare / export) and tell the host which run is active.
  useEffect(() => {
    if (!sessionId || !turns.some(t => t.role === 'user')) return;
    setRuns(prev => appendRun(prev, { runId: sessionId, engine: runEngine, at: Date.now(), file: props.fileLabel, turns, traces, ...(runContext.length ? { contextVariables: runContext } : {}), ...(runPreset ? { contextPreset: runPreset } : {}) }));
  }, [sessionId, turns, traces, runEngine, props.fileLabel, runContext, runPreset]);
  const { onRunChange } = props;
  useEffect(() => {
    onRunChange?.(sessionId ? { runId: sessionId, engine: runEngine, turn: turns.filter(t => t.role === 'user').length } : null);
  }, [sessionId, runEngine, turns, onRunChange]);

  const loadSuite = useCallback(async () => {
    if (!path || !projectId) { setSuite(null); return; }
    const result = await rpc<never>(STUDIO_RPC.suites, { agentPath: path }).catch(() => null);
    const list = (result as { suites?: SuiteEntry[] } | null)?.suites;
    if (alive.current && Array.isArray(list)) setSuite(list[0] ?? null);
  }, [rpc, path, projectId]);
  useEffect(() => { void loadSuite(); }, [loadSuite]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const row = payload as { kind?: string; projectId?: string } | null;
    if (row?.kind === 'suites' && (!row.projectId || row.projectId === projectId)) void loadSuite();
  });

  const setEngine = (next: StudioEngine) => { setInnerEngine(next); props.onEngineChange?.(next); };
  const running = Boolean(sessionId);
  const liveBlocked = engine === 'live' && !path;
  const stale = running && props.source !== runSource;
  const currentRun = useMemo(() => runs.find(r => r.runId === sessionId) ?? null, [runs, sessionId]);

  async function perform(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }

  /** `byUser`: a click on Start or Send, which approves the run itself; a host command does not. */
  async function start(byUser = false, initialContext = context.values, contextPreset: AppliedContextPreset | null = context.presetIdentity) {
    const contextVariables = parsePreviewContext(initialContext);
    const previous = active.current;
    const beforeClose = epoch.current;
    if (previous) {
      const ended = await close(previous);
      if (!ended.ok) throw Error(ended.error || 'The current preview could not end. Retry before restarting.');
      // A scope change may have released the run while End was in flight.
      if (epoch.current !== beforeClose) return;
      active.current = null;
    }
    release();
    setTurns([]); setTraces({}); setOpen({}); setTracing({});
    const started = epoch.current;
    const owner = { engine, ...(projectId ? { projectId } : {}), ...(path ? { path } : {}), ...(props.orgAlias ? { orgAlias: props.orgAlias } : {}), ...(props.threadId ? { threadId: props.threadId } : {}) };
    const lab = engineToLab(engine);
    let run: ActiveRun; let first: RunTurn[] = [];
    if (lab) {
      const res = await rpc<LabSnapshot>('agentLab.start', { engine: lab, source: props.source, ...(contextVariables.length ? { contextVariables } : {}), ...(path ? { path } : {}), ...(props.threadId ? { threadId: props.threadId } : {}), ...(byUser ? { startedByUser: true } : {}) });
      if (!res.ok || !res.data) throw new Error(res.error || 'The preview could not start.');
      run = { ...owner, id: res.data.id }; first = snapshotTurns(res.data);
    } else {
      const res = await rpc<{ sessionId?: string | null }>('agentPreview.start', { threadId: props.threadId, orgAlias: props.orgAlias, path, live: true, ...(contextVariables.length ? { contextVariables } : {}), ...(byUser ? { startedByUser: true } : {}) });
      const id = res.data?.sessionId;
      if (!res.ok || !id) throw new Error(res.error || 'Live preview could not start.');
      run = { ...owner, id };
    }
    // The panel closed or the file changed while starting: nobody owns this run, so end it.
    if (started !== epoch.current) { void close(run).catch(() => undefined); return; }
    active.current = run;
    setSessionId(run.id); setTurns(first);
    setRunEngine(engine); setRunSource(props.source);
    setRunContext(contextVariables); setRunPreset(contextPreset); context.markApplied(contextVariables, contextPreset); context.setSetup(false); context.setTab('conversation');
  }
  async function end() {
    const current = active.current;
    if (!current) return;
    active.current = null;
    setSessionId(null);
    const res = await close(current).catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    // A lab run is a local handle that is gone either way; a Live session may still be open on the org.
    if (current.engine === 'live' && !res.ok) throw new Error(`The Live session may still be open on the org: ${res.error || 'it did not confirm the end.'}`);
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !active.current) return;
    setDraft('');
    await sendText(text, true);
  }
  async function sendText(text: string, byUser = false) {
    const current = active.current;
    if (!current) return;
    if (current.engine === 'live') {
      setTurns(prev => [...prev, { role: 'user', text }]);
      const res = await rpc<{ response?: string; planId?: string }>('agentPreview.send', { sessionId: current.id, utterance: text, path: current.path, live: true, orgAlias: current.orgAlias, threadId: current.threadId, ...(byUser ? { startedByUser: true } : {}) });
      if (!res.ok) throw new Error(res.error || 'The agent did not respond.');
      const reply = res.data?.response?.trim();
      if (reply) setTurns(prev => [...prev, { role: 'agent', text: reply, ...(res.data?.planId ? { planId: res.data.planId } : {}) }]);
    } else {
      const res = await rpc<LabSnapshot>('agentLab.send', { id: current.id, text });
      if (!res.ok || !res.data) throw new Error(res.error || 'The agent did not respond.');
      setTurns(snapshotTurns(res.data));
    }
  }

  // Host commands run once per seq, after the selected engine matches the command's engine.
  const handledSeq = useRef(0);
  const { command } = props;
  useEffect(() => {
    if (!command || command.seq === handledSeq.current) return;
    if (command.type === 'context') {
      handledSeq.current = command.seq;
      props.onCommandHandled?.(command.seq);
      context.applyAgent({ ...(command.preset ? { preset: command.preset } : { values: command.contextVariables ?? [] }), ...(command.merge ? { merge: true } : {}) });
      return;
    }
    if (command.engine && command.engine !== engine) return;
    if (locked.current) return;
    handledSeq.current = command.seq;
    props.onCommandHandled?.(command.seq);
    void perform(async () => {
      if (liveBlocked) throw new Error('Live preview needs a saved .agent file.');
      const preset = command.type === 'start' ? command.preset : undefined;
      if (!command.contextVariables && !preset && context.error) throw Error(context.error);
      if (preset) context.loadPreset(preset);
      else if (command.contextVariables) context.adopt(command.contextVariables);
      const initial = preset?.values ?? command.contextVariables ?? context.values;
      const identity = preset ? { id: preset.id, name: preset.name, revision: preset.revision, edited: false } : command.contextVariables ? null : context.presetIdentity;
      if (command.type === 'start' || !active.current || active.current.engine !== engine) await start(false, initial, identity);
      if (command.type === 'send') {
        const text = command.text?.trim();
        if (!text) throw new Error('preview.send needs text.');
        await sendText(text);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, engine, busy]);

  async function toggleTrace(index: number, turn: RunTurn) {
    const next = !open[index];
    setOpen(prev => ({ ...prev, [index]: next }));
    const run = sessionId;
    // Only Simulate has a runtime trace; a failed fetch is retried on the next expand.
    if (!next || !run || runEngine !== 'simulate' || !turn.planId || traces[turn.planId]?.available) return;
    const planId = turn.planId;
    setTracing(prev => ({ ...prev, [index]: true }));
    try {
      const res = await rpc<TurnTrace>(STUDIO_RPC.trace, { id: run, planId, path, engine: runEngine });
      const trace = res.ok && res.data ? res.data : unavailable(run, res.error || 'Trace request failed.', planId);
      if (alive.current) setTraces(prev => ({ ...prev, [planId]: trace }));
    } catch (err) {
      if (alive.current) setTraces(prev => ({ ...prev, [planId]: unavailable(run, err instanceof Error ? err.message : String(err), planId) }));
    } finally { if (alive.current) setTracing(prev => ({ ...prev, [index]: false })); }
  }

  async function runSuite(caseIds?: string[]) {
    if (!suite || engine === 'live') return;
    setSuiteBusy(caseIds?.length ? 'Running case…' : `Running ${suite.cases.length} cases…`); setError('');
    try {
      const res = await rpc<never>(STUDIO_RPC.suiteRun, { path: suite.path, agentPath: path, source: props.source, engine: engineToLab(engine), startedByUser: true, ...(props.threadId ? { threadId: props.threadId } : {}), ...(caseIds ? { caseIds } : {}) });
      const next = (res as { suite?: SuiteEntry }).suite;
      if (!res.ok || !next) throw new Error(res.error || 'The suite could not run.');
      if (alive.current) setSuite(prev => ({ ...next, sha256: prev?.sha256 ?? next.sha256 }));
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { if (alive.current) setSuiteBusy(''); }
  }
  async function saveScenario(event: FormEvent) {
    event.preventDefault();
    const run = currentRun ?? runs[0];
    if (!run || !path) return;
    try {
      const fresh = (await rpc<never>(STUDIO_RPC.suites, { agentPath: path }) as { suites?: SuiteEntry[] }).suites?.[0] ?? null;
      const cases = [...(fresh?.cases ?? []), caseFromRun(run, saveName, saveCriteria)];
      const res = await rpc<never>(STUDIO_RPC.suiteSave, { agentPath: path, cases, ...(fresh?.sha256 ? { expectedSha256: fresh.sha256 } : {}) });
      const saved = (res as { suite?: SuiteEntry }).suite;
      if (!res.ok || !saved) throw new Error(res.error || 'The scenario could not be saved.');
      if (alive.current) { setSuite(saved); setSaving(false); setSaveName(''); setSaveCriteria(''); }
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
  }

  const cmpRuns = compare ? [runs.find(r => r.runId === compare[0]), runs.find(r => r.runId === compare[1])] : [];
  const rows = cmpRuns[0] && cmpRuns[1] ? diffRuns(cmpRuns[0], cmpRuns[1]) : [];

  return (
    <section className="sf-studio sf-pw" data-testid="preview-workbench" aria-label="Agent preview">
      <style>{STUDIO_TOKENS}{PREVIEW_WORKBENCH_STYLES}{PREVIEW_SUITE_STYLES}{TRACE_PANEL_STYLES}{PREVIEW_CONTEXT_STYLES}</style>
      <div className="sf-pw-bar">
        <div className="sf-pw-seg" role="group" aria-label="Preview engine">
          {PREVIEW_ENGINES.map(e => <button key={e} type="button" aria-pressed={engine === e} disabled={busy || running} title={ENGINE_COPY[e].hint} onClick={() => setEngine(e)}>{ENGINE_COPY[e].title}</button>)}
        </div>
        <span className="sf-pw-spacer" />
        {running
          ? <button type="button" className="sf-pw-btn" disabled={busy} onClick={() => void perform(end)}>End</button>
          : <button type="button" className="sf-pw-btn is-primary" data-testid="pw-start" disabled={busy || context.loading || liveBlocked || (engine !== 'live' && !props.source.trim())} onClick={() => context.fields.length || context.count || context.discoveryError ? context.setSetup(true) : void perform(() => start(true))}>{busy ? 'Starting…' : 'Start'}</button>}
        {runs.length > 0 && <button type="button" className="sf-pw-btn" onClick={() => currentRun || runs[0] ? download('agentforce-run.json', exportRunPayload(currentRun ?? runs[0]!)) : undefined}>Export run</button>}
        {runs.length > 1 && <button type="button" className="sf-pw-btn" aria-pressed={Boolean(compare)} onClick={() => setCompare(compare ? null : [runs[0]!.runId, runs[1]!.runId])}>Compare runs</button>}
        {running && turns.some(t => t.role === 'user') && <button type="button" className="sf-pw-btn" disabled={!path} title={path ? 'Save this conversation as a scenario' : 'Open a saved .agent file to save scenarios'} onClick={() => setSaving(s => !s)}>Save as scenario</button>}
      </div>
      <div className={engine === 'live' ? 'sf-pw-hint is-warn' : 'sf-pw-hint'}>
        {engine === 'simulate' ? 'Compiles this draft through the Preview API. Actions are simulated.' : liveBlocked ? 'Open a saved .agent file to run Live.' : `Live runs real actions${props.orgAlias ? ` on ${props.orgAlias}` : ' on the connected org'}.${props.dirty ? ' It runs the saved file, so save to include your edits.' : ''}`}
        {stale && ' Your script changed; start a new run to test the edits.'}
      </div>
      {error && <div className="sf-pw-err" role="alert">{error}</div>}
      <PreviewContextTabs context={context} />
      {context.tab === 'context' && <div className="sf-context-panel" id={`${context.id}-context-panel`} role="tabpanel" aria-labelledby={`${context.id}-context`}><PreviewContextEditor context={context} running={running} onRestart={() => context.setSetup(true)} /></div>}
      <div className="sf-context-conversation" id={`${context.id}-conversation-panel`} role="tabpanel" aria-labelledby={`${context.id}-conversation`} hidden={context.tab !== 'conversation'}>
      {path && (suite || suiteBusy) && (
        <PreviewSuite key={`${projectId}:${path}:${suite?.id}`} suite={suite} busy={suiteBusy} disabled={engine === 'live' || running} onRun={ids => void runSuite(ids)} />
      )}
      <div className="sf-pw-log" role="log" aria-label="Preview conversation">
        {turns.length === 0
          ? <div className="sf-pw-empty">{busy ? 'Starting…' : <><strong>{props.fileLabel || 'Current draft'}</strong><p>Start a conversation, then expand “trace” on any reply to see how the agent decided.</p></>}</div>
          : turns.map((turn, index) => (
            <div key={index} className={`sf-pw-msg is-${turn.role}`} data-role={turn.role}>
              <div className="sf-pw-bubble">{turn.text}</div>
              {turn.role === 'agent' && (
                <>
                  <div className="sf-pw-meta">
                    {turn.latencyMs !== undefined && <span>{(turn.latencyMs / 1000).toFixed(1)}s</span>}
                    <button type="button" className="sf-pw-link" aria-expanded={Boolean(open[index])} onClick={() => void toggleTrace(index, turn)}>trace {open[index] ? '▾' : '▸'}</button>
                  </div>
                  {open[index] && (
                    runEngine === 'rehearse'
                      ? <TracePanel trace={null} approximation />
                      : runEngine === 'live'
                        ? <TracePanel trace={unavailable(sessionId ?? '', LIVE_TRACE_REASON)} />
                      : !turn.planId
                        ? <TracePanel trace={unavailable(sessionId ?? '', 'This turn has no plan id, so there is no runtime trace.')} />
                        // An ended run keeps its conversation, but only traces fetched while it ran.
                        : <TracePanel trace={traces[turn.planId] ?? (running ? null : unavailable('', 'This run has ended, so its runtime trace is no longer available. Start a new run to trace replies.', turn.planId))} loading={Boolean(tracing[index])} onRevealSource={props.onRevealSource} />
                  )}
                </>
              )}
            </div>
          ))}
      </div>
      {saving && (
        <form className="sf-pw-panel" aria-label="Save as scenario" onSubmit={e => void saveScenario(e)}>
          <label>Scenario name<input value={saveName} maxLength={200} onChange={e => setSaveName(e.target.value)} placeholder="Refund request" /></label>
          <label>Success criteria (optional, AI-judged)<input value={saveCriteria} maxLength={4000} onChange={e => setSaveCriteria(e.target.value)} /></label>
          <div><button type="submit" className="sf-pw-btn is-primary" disabled={!saveName.trim()}>Save to tests/</button></div>
        </form>
      )}
      {compare && runs.length > 1 && (
        <div className="sf-pw-panel" aria-label="Compare runs">
          <div className="sf-pw-cmp">
            {JSON.stringify(cmpRuns[0]?.contextVariables ?? []) !== JSON.stringify(cmpRuns[1]?.contextVariables ?? []) && <p className="sf-pw-meta">These runs used different context values. Export each run to inspect its starting context.</p>}
            {[0, 1].map(i => <select key={i} aria-label={`Run ${i === 0 ? 'A' : 'B'}`} value={compare[i]} onChange={e => setCompare(i === 0 ? [e.target.value, compare[1]] : [compare[0], e.target.value])}>
              {runs.map(r => <option key={r.runId} value={r.runId}>{`${r.engine} · ${new Date(r.at).toLocaleTimeString()} · ${r.runId.slice(0, 6)}`}</option>)}
            </select>)}
            {rows.length === 0 && <div>No agent replies to compare.</div>}
            {rows.map(row => (
              <FragmentRow key={row.index} row={row} />
            ))}
          </div>
        </div>
      )}
      <form className="sf-pw-composer" onSubmit={e => void perform(() => send(e))}>
        <input aria-label="Preview message" placeholder={running ? 'Ask your agent something…' : 'Start a run to talk to your agent'} disabled={!running || busy} value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} />
        <button type="submit" className="sf-pw-btn is-primary" aria-label="Send preview message" disabled={!running || busy || !draft.trim()}>Send</button>
      </form>
      </div>
      {context.setup && <PreviewContextSetup context={context} error={error} busy={busy} running={running} onClose={() => context.setSetup(false)} onStart={() => void perform(() => start(true))} />}
    </section>
  );
}

function FragmentRow({ row }: { row: ReturnType<typeof diffRuns>[number] }) {
  const differs = !row.sameText || !row.sameTopic;
  return (
    <>
      <div className="sf-pw-meta">Turn {row.index}{row.user ? ` · “${row.user.slice(0, 60)}”` : ''}{differs ? ' · differs' : ' · same'}</div>
      <div className={differs ? 'is-diff' : ''} data-testid="cmp-a">{row.topicA && <em>[{row.topicA}] </em>}{row.a?.text ?? '—'}</div>
      <div className={differs ? 'is-diff' : ''} data-testid="cmp-b">{row.topicB && <em>[{row.topicB}] </em>}{row.b?.text ?? '—'}</div>
    </>
  );
}
