import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { foldDiff, lineDiff } from '../../lib/line-diff.js';
import { SYNC_RPC, type SyncCheck, type SyncDiff, type SyncJob, type SyncPlanFile } from '../../lib/org-sync-contract.js';
import { requireResult } from './components/client.js';
import { SALESFORCE_STYLES } from './components/styles.js';
import { OrgSyncPicker, PICKER_STYLES, type PickerPreset } from './OrgSyncPicker.js';
import { PICK_TYPES, modeKeys, needsAttention, pickRows, readMemory, selectable, typeMode, writeMemory, type PickMemory } from './org-sync-picker.js';

type Call = (method: string, args?: Record<string, unknown>) => Promise<unknown>;
type Ready = Extract<SyncJob, { state: 'ready' }>;
type Applied = Extract<SyncJob, { state: 'applied' }>;

/** Rows rendered per plan list. */
const VISIBLE_ROWS = 100;
const POLL_MS = 1000;
const MARK = { add: '+', del: '−', same: ' ' } as const;
const STYLES = `
.sf-sync { width:640px; overflow:hidden; }
/* Header and footer stay put; only the lists scroll, so Fetch and Write are always in reach. */
.sf-sync[open] { display:flex; flex-direction:column; }
.sf-sync .sf-login-body { gap:14px; flex:1 1 auto; min-height:0; overflow:auto; grid-template-columns:minmax(0,1fr); }
.sf-sync-group { border:1px solid var(--border); border-radius:8px; }
.sf-sync-group > header { display:flex; align-items:center; gap:8px; padding:8px 10px; background:var(--bg-base); border-radius:8px 8px 0 0; }
.sf-sync-group > header small, .sf-sync-row small { color:var(--text-muted); }
.sf-sync-rows { max-height:200px; overflow:auto; }
.sf-sync-row { display:flex; align-items:center; gap:8px; padding:5px 10px; border-top:1px solid var(--border); overflow-wrap:anywhere; }
.sf-sync-row > span { flex:1; min-width:0; }
.sf-sync-more { padding:5px 10px; border-top:1px solid var(--border); color:var(--text-muted); font-size:11px; }
.sf-sync-progress { height:4px; border-radius:2px; background:var(--bg-base); overflow:hidden; }
.sf-sync-progress > span { display:block; height:100%; background:var(--accent); transition:width .3s; }
/* Nothing has come back yet: a sweeping bar shows the retrieve is alive. */
.sf-sync-progress.is-waiting > span { width:30% !important; animation:sf-sync-sweep 1.4s ease-in-out infinite; }
@keyframes sf-sync-sweep { from { transform:translateX(-100%); } to { transform:translateX(340%); } }
.sf-sync-choice { display:flex; gap:4px; }
.sf-sync-choice .sf-btn { padding:3px 8px; font-size:11px; }
.sf-sync-choice .sf-btn[aria-pressed=true] { background:var(--accent); color:var(--bg-panel); }
.sf-sync-code { margin:0; padding:6px 0; max-height:260px; overflow:auto; border-top:1px solid var(--border); font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
.sf-sync-line { display:flex; white-space:pre; padding-right:8px; }
.sf-sync-line.is-add { background:color-mix(in srgb,var(--success, #2e844a) 14%,transparent); }
.sf-sync-line.is-del { background:color-mix(in srgb,var(--danger) 14%,transparent); }
.sf-sync-line.is-gap { color:var(--text-muted); font-style:italic; }
.sf-sync-ln { flex:0 0 22px; text-align:center; color:var(--text-muted); user-select:none; }
@media (prefers-reduced-motion:reduce) { .sf-sync-progress > span { transition:none; } .sf-sync-progress.is-waiting > span { animation:none; width:100% !important; opacity:.4; } }
`;

const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;
/** `force-app/main/default/classes/A.cls` → `classes/A.cls`; the full path stays in the tooltip. */
const short = (path: string) => path.replace(/^(?:.*\/)?main\/default\//, '');
/** `75` → `1m 15s`. */
export const elapsed = (seconds: number) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const names = (keys: string[]) => `${keys.slice(0, 20).map(key => key.slice(key.indexOf(':') + 1)).join(', ')}${keys.length > 20 ? ` and ${keys.length - 20} more` : ''}`;

/** Everything an agent check found except deletions; fetching compares contents, so unchanged files are dropped. */
export const agentSelection = (check: SyncCheck) => new Set(check.components.filter(row => row.state !== 'deleted').map(row => row.key));

/** What opens selected: the agent and what it uses, the remembered type modes, or everything that needs attention. */
export function initialSelection(check: SyncCheck, agentCheck: SyncCheck | null, memory: PickMemory | null): Set<string> {
  if (agentCheck) return agentSelection(agentCheck);
  const rows = pickRows(check);
  if (memory) return new Set(PICK_TYPES.flatMap(([type]) => memory[type] ? modeKeys(type, memory[type]!, rows.get(type) ?? []) : []));
  return new Set([...rows.values()].flat().filter(needsAttention).map(row => row.key));
}

/** The whole-type modes worth remembering; a hand-picked type is left out. */
export function memoryOf(check: SyncCheck, selected: Set<string>): PickMemory {
  const rows = pickRows(check);
  const modes: PickMemory = {};
  for (const [type] of PICK_TYPES) {
    const mode = typeMode(type, rows.get(type) ?? [], selected);
    if (mode !== 'custom' && mode !== 'none') modes[type] = mode;
  }
  return modes;
}

/**
 * Fetch from org. Every metadata type is checked at once and picked by type or by component; with `agent`, the
 * agent and what its actions and types use open selected. Nothing is written until the plan is reviewed.
 */
export function OrgSyncDialog({ call, agent, rememberKey, onClose }: { call: Call; agent?: string; rememberKey?: string; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const alive = useRef(true);
  const job = useRef('');
  const [check, setCheck] = useState<SyncCheck | null>(null);
  const [agentCheck, setAgentCheck] = useState<SyncCheck | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [remember, setRemember] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: 'retrieve' | 'compare'; started: number } | null>(null);
  const [plan, setPlan] = useState<Ready | null>(null);
  const [take, setTake] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Applied | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const cancelJob = () => {
    const id = job.current;
    job.current = '';
    if (id) void call(SYNC_RPC.cancel, { jobId: id }).catch(() => undefined);
  };
  const close = () => { cancelJob(); onClose(); };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      alive.current = false;
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  // A closed panel must not leave a temp retrieve behind.
  useEffect(() => () => cancelJob(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let current = true;
    setBusy(true); setError('');
    const load = (args: Record<string, unknown>) => call(SYNC_RPC.check, args).then(value => requireResult<{ data: SyncCheck }>(value).data);
    Promise.all([load({ scope: 'all', current: true }), agent ? load({ agent }) : Promise.resolve(null)]).then(([full, related]) => {
      if (!current) return;
      setCheck(full);
      setAgentCheck(related);
      setSelected(initialSelection(full, related, agent ? null : readMemory(rememberKey)));
    }).catch(e => { if (current) setError(message(e)); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [agent, call, rememberKey]);

  const presets = useMemo<PickerPreset[]>(() => {
    if (!check) return [];
    const rows = [...pickRows(check).values()].flat();
    const attention = rows.filter(needsAttention).map(row => row.key);
    const open = rows.filter(selectable).map(row => row.key);
    return [
      { label: 'All changes', count: attention.length, keys: attention },
      ...(agentCheck ? [{ label: `${agentCheck.agent?.name ?? agent} + what it uses`, keys: [...agentSelection(agentCheck)] }] : []),
      { label: 'Everything', count: open.length, keys: open },
    ];
  }, [agent, agentCheck, check]);
  const notes = useMemo(() => {
    const deleted = check?.components.filter(row => row.state === 'deleted').map(row => row.key) ?? [];
    const missing = agentCheck?.agent?.missing ?? [];
    return [
      ...(missing.length ? [`Used by ${agentCheck!.agent!.name} but not in the org: ${names(missing)}`] : []),
      ...(deleted.length ? [`No longer in the org, kept locally: ${names(deleted)}`] : []),
    ];
  }, [agentCheck, check]);

  async function fetchSelected(keys = [...selected]) {
    if (!check || !keys.length) return;
    if (rememberKey && !agent) writeMemory(rememberKey, remember ? memoryOf(check, selected) : null);
    setBusy(true); setError(''); setProgress({ done: 0, total: keys.length, phase: 'retrieve', started: Date.now() });
    try {
      const started = requireResult<{ jobId: string }>(await call(SYNC_RPC.start, { components: keys, orgId: check.org.orgId }));
      job.current = started.jobId;
      for (;;) {
        const state = requireResult<{ data: SyncJob }>(await call(SYNC_RPC.status, { jobId: started.jobId })).data;
        if (!alive.current || job.current !== started.jobId) return;
        if (state.state === 'failed') throw Error(state.error);
        if (state.state === 'ready') {
          setPlan(state);
          setTake(new Set());
          if (!state.files.some(file => file.action !== 'same')) cancelJob();
          return;
        }
        if (state.state === 'running') setProgress(previous => ({ done: state.done, total: state.total, phase: state.phase ?? 'retrieve', started: previous?.started ?? Date.now() }));
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
      }
    } catch (e) {
      job.current = '';
      if (alive.current) { setError(message(e)); setProgress(null); }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function apply() {
    const id = job.current;
    if (!id) return;
    setBusy(true); setError('');
    try {
      const state = requireResult<{ data: SyncJob }>(await call(SYNC_RPC.apply, { jobId: id, take: [...take] })).data;
      job.current = '';
      if (!alive.current) return;
      if (state.state !== 'applied') throw Error(state.state === 'failed' ? state.error : 'The fetch is no longer available. Check again.');
      setResult(state);
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const step = result ? 'done' : plan ? 'plan' : progress ? 'fetching' : 'check';
  const changes = plan?.files.filter(file => file.action !== 'same') ?? [];
  const conflicts = changes.filter(file => file.action === 'conflict');
  const writes = changes.length - conflicts.length + take.size;
  const heading = agent ? `Fetch ${agent} from org` : 'Fetch from org';
  let footer: ReactNode;
  if (step === 'plan' && changes.length) footer = <button type="button" className="sf-btn primary" disabled={busy || !writes} onClick={() => void apply()}>
    {busy ? 'Applying…' : `Write ${plural(writes, 'file')}`}</button>;

  return <dialog className={`sf-login-dialog sf-sync${step === 'check' ? ' is-picker' : ''}`} ref={ref} aria-labelledby={title} onCancel={event => { event.preventDefault(); closeRef.current(); }}>
    <style>{SALESFORCE_STYLES + STYLES + PICKER_STYLES}</style>
    {step === 'check' ? <>
      <OrgSyncPicker title={heading} titleId={title} check={check} busy={busy} error={check ? '' : error}
        status={agent ? `Comparing the org with this project and what ${agent} uses…` : 'Comparing the org with this project…'}
        selected={selected} onSelect={setSelected} presets={presets} notes={notes}
        remember={rememberKey && !agent ? remember : undefined} onRemember={setRemember}
        onCompare={() => void fetchSelected()} onCancel={close} />
      {check && error && <p className="sf-login-error" role="alert" style={{ margin: '0 22px 12px' }}>{error}</p>}
    </> : <>
      <div className="sf-login-heading">
        <h2 id={title}>{heading}</h2>
        <p>{check ? `${check.org.alias} · ` : ''}Nothing is written until you review the changes.</p>
      </div>
      <div className="sf-login-body">
        {step === 'fetching' && progress && <FetchProgress progress={progress} />}
        {step === 'plan' && plan && <PlanView plan={plan} changes={changes} take={take} onTake={setTake} call={call} jobId={job.current} />}
        {step === 'done' && result && <ResultView result={result} />}
        {error && <p className="sf-login-error" role="alert">{error}</p>}
      </div>
      <div className="sf-login-footer">
        <p>Local edits are never overwritten without your choice.</p>
        <div className="sf-login-buttons">
          <button type="button" className="sf-btn quiet" onClick={close}>{step === 'done' || (step === 'plan' && !changes.length) ? 'Close' : 'Cancel'}</button>
          {footer}
        </div>
      </div>
    </>}
  </dialog>;
}

function FetchProgress({ progress }: { progress: { done: number; total: number; phase: 'retrieve' | 'compare'; started: number } }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const { done, total, phase } = progress;
  const comparing = phase === 'compare';
  const percent = total ? Math.round(done / total * 100) : 0;
  const time = elapsed(Math.max(0, Math.floor((now - progress.started) / 1000)));
  return <div role="status">
    <p>{comparing ? `Comparing ${plural(total, 'component')} with your project…` : `Retrieving ${plural(total, 'component')} into a temporary folder…`}</p>
    <div className={`sf-sync-progress${!comparing && done === 0 ? ' is-waiting' : ''}`} aria-hidden="true"><span style={{ width: `${comparing ? 100 : percent}%` }} /></div>
    <p className="sf-muted sf-small">{comparing
      ? `All retrieved · ${time}`
      : `${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} retrieved${done ? ` (${percent}%)` : ''} · ${time}`}</p>
    {!comparing && total > 1000 && <p className="sf-muted sf-small">Large fetches run in parallel batches; Salesforce can take a few minutes for each.</p>}
  </div>;
}

function PlanView({ plan, changes, take, onTake, call, jobId }: { plan: Ready; changes: SyncPlanFile[]; take: Set<string>; onTake(next: Set<string>): void; call: Call; jobId: string }) {
  const [open, setOpen] = useState('');
  const count = (action: SyncPlanFile['action']) => plan.files.filter(file => file.action === action).length;
  const conflicts = changes.filter(file => file.action === 'conflict');
  const choose = (path: string, org: boolean) => {
    const next = new Set(take);
    if (org) next.add(path); else next.delete(path);
    onTake(next);
  };
  const summary = [[count('update'), 'to update'], [count('create'), 'new'], [count('conflict'), 'in conflict'], [count('same'), 'already identical']] as const;
  return <>
    <p role="status">{changes.length
      ? summary.filter(([n]) => n).map(([n, label]) => `${n.toLocaleString('en-US')} ${label}`).join(' · ')
      : `Your project already matches the org for ${plural(plan.components, 'component')}.`}</p>
    {conflicts.length > 0 && <section className="sf-sync-group" aria-label="Conflicts">
      <header>
        <span className="sf-grow"><strong>Changed in both</strong><br /><small>Keep local leaves your file alone. Take org replaces it.</small></span>
        <button type="button" className="sf-btn quiet" onClick={() => onTake(take.size === conflicts.length ? new Set() : new Set(conflicts.map(file => file.path)))}>
          {take.size === conflicts.length ? 'Keep local for all' : 'Take org for all'}</button>
      </header>
      <div className="sf-sync-rows" style={{ maxHeight: 320 }}>
        {conflicts.map(file => <div key={file.path}>
          <div className="sf-sync-row">
            <span title={file.path}>{short(file.path)} {file.added !== undefined && <small>+{file.added} −{file.removed}</small>}</span>
            <button type="button" className="sf-btn quiet" aria-expanded={open === file.path} onClick={() => setOpen(open === file.path ? '' : file.path)}>Diff</button>
            <div className="sf-sync-choice" role="group" aria-label={`Resolve ${file.path}`}>
              <button type="button" className="sf-btn quiet" aria-pressed={!take.has(file.path)} onClick={() => choose(file.path, false)}>Keep local</button>
              <button type="button" className="sf-btn quiet" aria-pressed={take.has(file.path)} onClick={() => choose(file.path, true)}>Take org</button>
            </div>
          </div>
          {open === file.path && <FileDiff call={call} jobId={jobId} path={file.path} />}
        </div>)}
      </div>
    </section>}
    {changes.length > conflicts.length && <section className="sf-sync-group" aria-label="Files to write">
      <header><span className="sf-grow"><strong>Will be written</strong></span></header>
      <div className="sf-sync-rows">
        {changes.filter(file => file.action !== 'conflict').slice(0, VISIBLE_ROWS).map(file => <div key={file.path} className="sf-sync-row">
          <span title={file.path}>{short(file.path)}</span><small>{file.action === 'create' ? 'new' : file.added !== undefined ? `+${file.added} −${file.removed}` : 'update'}</small>
        </div>)}
        {changes.length - conflicts.length > VISIBLE_ROWS && <div className="sf-sync-more">and {(changes.length - conflicts.length - VISIBLE_ROWS).toLocaleString('en-US')} more</div>}
      </div>
    </section>}
    {plan.missing.length > 0 && <p className="sf-muted sf-small">Not returned by the org: {plan.missing.slice(0, 20).join(', ')}{plan.missing.length > 20 ? ` and ${plan.missing.length - 20} more` : ''}</p>}
  </>;
}

function FileDiff({ call, jobId, path }: { call: Call; jobId: string; path: string }) {
  const [diff, setDiff] = useState<SyncDiff | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    call(SYNC_RPC.diff, { jobId, path })
      .then(value => { if (current) setDiff(requireResult<{ data: SyncDiff }>(value).data); })
      .catch(e => { if (current) setError(message(e)); });
    return () => { current = false; };
  }, [call, jobId, path]);
  const lines = useMemo(() => diff ? lineDiff(diff.local, diff.org) : null, [diff]);
  if (error) return <p className="sf-login-error sf-small" role="alert">{error}</p>;
  if (!diff) return <p className="sf-muted sf-small" role="status">Loading diff…</p>;
  if (!lines) return <p className="sf-muted sf-small" role="status">These versions differ in too many lines to diff here.</p>;
  return <>{diff.truncated && <p className="sf-muted sf-small" role="status">The file is large, so only its start is compared here.</p>}<pre className="sf-sync-code" aria-label={`Local to org changes in ${path}`}>{foldDiff(lines).map((hunk, index) => hunk.type === 'gap'
    ? <span key={index} className="sf-sync-line is-gap"><span className="sf-sync-ln" />⋯ {hunk.count} unchanged line{hunk.count === 1 ? '' : 's'}</span>
    : hunk.lines.map((line, row) => <span key={`${index}:${row}`} className={`sf-sync-line${line.type === 'same' ? '' : ` is-${line.type}`}`}>
      <span className="sf-sync-ln">{MARK[line.type]}</span>{line.text}</span>))}</pre></>;
}

function ResultView({ result }: { result: Applied }) {
  return <div role="status">
    <p><strong>Wrote {plural(result.written, 'file')}.</strong>{result.kept ? ` Kept ${plural(result.kept, 'local file')}.` : ''}</p>
    {result.skipped.length > 0 && <>
      <p className="sf-muted">Skipped {plural(result.skipped.length, 'file')}:</p>
      <ul className="sf-small">{result.skipped.slice(0, 50).map(row => <li key={row.path}>{row.path}: {row.reason}</li>)}</ul>
    </>}
  </div>;
}
