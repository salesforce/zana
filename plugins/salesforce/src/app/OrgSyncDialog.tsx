import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { foldDiff, lineDiff } from '../../lib/line-diff.js';
import {
  SCOPE_LABELS, SYNC_FETCH_MAX, SYNC_RPC, SYNC_SCOPES, TYPE_LABELS,
  type SyncCheck, type SyncComponent, type SyncDiff, type SyncJob, type SyncPlanFile, type SyncScope,
} from '../../lib/org-sync-contract.js';
import { requireResult } from './components/client.js';
import { SALESFORCE_STYLES } from './components/styles.js';

type Call = (method: string, args?: Record<string, unknown>) => Promise<unknown>;
type Ready = Extract<SyncJob, { state: 'ready' }>;
type Applied = Extract<SyncJob, { state: 'applied' }>;
type Group = { id: string; title: string; hint: string; preselect: boolean; rows: SyncComponent[] };

/** Rows rendered per group; selection still covers the whole group. */
const VISIBLE_ROWS = 100;
const POLL_MS = 1000;
const MARK = { add: '+', del: '−', same: ' ' } as const;
const STYLES = `
.sf-sync { width:640px; overflow:hidden; }
/* Header and footer stay put; only the lists scroll, so Fetch and Write are always in reach. */
.sf-sync[open] { display:flex; flex-direction:column; }
.sf-sync .sf-login-body { gap:14px; flex:1 1 auto; min-height:0; overflow:auto; grid-template-columns:minmax(0,1fr); }
.sf-sync-scope { display:flex; gap:6px; flex-wrap:wrap; }
.sf-sync-group { border:1px solid var(--border); border-radius:8px; }
.sf-sync-group > header { display:flex; align-items:center; gap:8px; padding:8px 10px; background:var(--bg-base); border-radius:8px 8px 0 0; }
.sf-sync-group > header small, .sf-sync-row small { color:var(--text-muted); }
.sf-sync-rows { max-height:200px; overflow:auto; }
.sf-sync-row { display:flex; align-items:center; gap:8px; padding:5px 10px; border-top:1px solid var(--border); overflow-wrap:anywhere; }
.sf-sync-row > span { flex:1; min-width:0; }
.sf-sync-more { padding:5px 10px; border-top:1px solid var(--border); color:var(--text-muted); font-size:11px; }
.sf-sync-progress { height:4px; border-radius:2px; background:var(--bg-base); overflow:hidden; }
.sf-sync-progress > span { display:block; height:100%; background:var(--accent); transition:width .3s; }
.sf-sync-choice { display:flex; gap:4px; }
.sf-sync-choice .sf-btn { padding:3px 8px; font-size:11px; }
.sf-sync-choice .sf-btn[aria-pressed=true] { background:var(--accent); color:var(--bg-panel); }
.sf-sync-code { margin:0; padding:6px 0; max-height:260px; overflow:auto; border-top:1px solid var(--border); font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
.sf-sync-line { display:flex; white-space:pre; padding-right:8px; }
.sf-sync-line.is-add { background:color-mix(in srgb,var(--success, #2e844a) 14%,transparent); }
.sf-sync-line.is-del { background:color-mix(in srgb,var(--danger) 14%,transparent); }
.sf-sync-line.is-gap { color:var(--text-muted); font-style:italic; }
.sf-sync-ln { flex:0 0 22px; text-align:center; color:var(--text-muted); user-select:none; }
@media (prefers-reduced-motion:reduce) { .sf-sync-progress > span { transition:none; } }
`;

const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;
const when = (at: string | null) => at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
/** `force-app/main/default/classes/A.cls` → `classes/A.cls`; the full path stays in the tooltip. */
const short = (path: string) => path.replace(/^(?:.*\/)?main\/default\//, '');
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Splits a check into the groups the user picks from; agent versions they already work on come first. */
export function syncGroups(check: SyncCheck): Group[] {
  const by = (test: (row: SyncComponent) => boolean) => check.components.filter(test);
  return [
    { id: 'conflict', title: 'Changed in both', hint: 'Local edits since the last fetch. You choose per file before anything is written.', preselect: true, rows: by(row => row.state === 'conflict') },
    { id: 'changed', title: 'Changed in org', hint: 'Untouched locally, so taking the org version is safe.', preselect: true, rows: by(row => row.state === 'changed') },
    { id: 'latest', title: 'Newer agent versions', hint: 'The newest org version of agents in this project.', preselect: true, rows: by(row => row.state === 'new' && Boolean(row.latest)) },
    { id: 'new', title: 'Only in org', hint: 'Not in this project yet.', preselect: false, rows: by(row => row.state === 'new' && !row.latest) },
    { id: 'unknown', title: 'Not compared yet', hint: 'Never fetched here. Fetching compares contents and only changed files are offered.', preselect: false, rows: by(row => row.state === 'unknown') },
  ].filter(group => group.rows.length);
}

export function OrgSyncDialog({ call, scope: initialScope, onClose }: { call: Call; scope: SyncScope; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const alive = useRef(true);
  const job = useRef('');
  const [scope, setScope] = useState(initialScope);
  const [check, setCheck] = useState<SyncCheck | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
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
    setBusy(true); setError(''); setCheck(null);
    call(SYNC_RPC.check, { scope }).then(value => {
      const data = requireResult<{ data: SyncCheck }>(value).data;
      if (!current) return;
      setCheck(data);
      setSelected(new Set(syncGroups(data).filter(group => group.preselect).flatMap(group => group.rows.map(row => row.key))));
    }).catch(e => { if (current) setError(message(e)); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [call, scope]);

  async function fetchSelected() {
    if (!check) return;
    setBusy(true); setError(''); setProgress({ done: 0, total: selected.size });
    try {
      const started = requireResult<{ jobId: string }>(await call(SYNC_RPC.start, { components: [...selected], orgId: check.org.orgId }));
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
        if (state.state === 'running') setProgress({ done: state.done, total: state.total });
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
  let footer: ReactNode;
  if (step === 'check') footer = <button type="button" className="sf-btn primary" disabled={busy || !selected.size || selected.size > SYNC_FETCH_MAX} onClick={() => void fetchSelected()}>
    {busy && !check ? 'Checking…' : `Fetch ${plural(selected.size, 'component')}`}</button>;
  else if (step === 'plan' && changes.length) footer = <button type="button" className="sf-btn primary" disabled={busy || !writes} onClick={() => void apply()}>
    {busy ? 'Applying…' : `Write ${plural(writes, 'file')}`}</button>;

  return <dialog className="sf-login-dialog sf-sync" ref={ref} aria-labelledby={title} onCancel={event => { event.preventDefault(); closeRef.current(); }}>
    <style>{SALESFORCE_STYLES + STYLES}</style>
    <div className="sf-login-heading">
      <h2 id={title}>Fetch latest from org</h2>
      <p>{check ? `${check.org.alias} · ` : ''}Nothing is written until you review the changes.</p>
    </div>
    <div className="sf-login-body">
      {step === 'check' && <>
        <div className="sf-sync-scope" role="group" aria-label="What to fetch">
          {SYNC_SCOPES.map(value => <button key={value} type="button" className={`sf-btn${value === scope ? ' primary' : ' quiet'}`} aria-pressed={value === scope} disabled={busy} onClick={() => setScope(value)}>{SCOPE_LABELS[value]}</button>)}
        </div>
        {check && <CheckView check={check} selected={selected} onSelect={setSelected} />}
      </>}
      {step === 'fetching' && progress && <div role="status">
        <p>Retrieving {plural(progress.total, 'component')} into a temporary folder…</p>
        <div className="sf-sync-progress" aria-hidden="true"><span style={{ width: `${progress.total ? Math.round(progress.done / progress.total * 100) : 0}%` }} /></div>
        <p className="sf-muted sf-small">{progress.done.toLocaleString('en-US')} of {progress.total.toLocaleString('en-US')} retrieved</p>
      </div>}
      {step === 'plan' && plan && <PlanView plan={plan} changes={changes} take={take} onTake={setTake} call={call} jobId={job.current} />}
      {step === 'done' && result && <ResultView result={result} />}
      {error && <p className="sf-login-error" role="alert">{error}</p>}
    </div>
    <div className="sf-login-footer">
      <p>{step === 'check' && selected.size > SYNC_FETCH_MAX ? `Fetch at most ${SYNC_FETCH_MAX.toLocaleString('en-US')} components at a time.` : 'Local edits are never overwritten without your choice.'}</p>
      <div className="sf-login-buttons">
        <button type="button" className="sf-btn quiet" onClick={close}>{step === 'done' || (step === 'plan' && !changes.length) ? 'Close' : 'Cancel'}</button>
        {footer}
      </div>
    </div>
  </dialog>;
}

function CheckView({ check, selected, onSelect }: { check: SyncCheck; selected: Set<string>; onSelect(next: Set<string>): void }) {
  const groups = useMemo(() => syncGroups(check), [check]);
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(selected);
    for (const key of keys) if (on) next.add(key); else next.delete(key);
    onSelect(next);
  };
  const deleted = check.components.filter(row => row.state === 'deleted');
  return <>
    <p className="sf-muted" role="status">
      {plural(check.counts.current, 'component')} up to date{groups.length ? '' : ' · Nothing new in the org'}{check.truncated ? ' · Showing the first results only' : ''}
    </p>
    {groups.map(group => {
      const keys = group.rows.map(row => row.key);
      const count = keys.filter(key => selected.has(key)).length;
      return <section key={group.id} className="sf-sync-group" aria-label={group.title}>
        <header>
          <input type="checkbox" aria-label={`Select all ${group.title}`} checked={count === keys.length}
            ref={input => { if (input) input.indeterminate = count > 0 && count < keys.length; }}
            onChange={event => toggle(keys, event.target.checked)} />
          <span className="sf-grow"><strong>{group.title}</strong> <small>{count} of {keys.length}</small><br /><small>{group.hint}</small></span>
        </header>
        <div className="sf-sync-rows">
          {group.rows.slice(0, VISIBLE_ROWS).map(row => <label key={row.key} className="sf-sync-row">
            <input type="checkbox" checked={selected.has(row.key)} onChange={event => toggle([row.key], event.target.checked)} />
            <span>{row.fullName} <small>{TYPE_LABELS[row.type]}</small></span>
            <small>{[row.modifiedBy, when(row.modifiedAt)].filter(Boolean).join(' · ')}</small>
          </label>)}
          {group.rows.length > VISIBLE_ROWS && <div className="sf-sync-more">and {(group.rows.length - VISIBLE_ROWS).toLocaleString('en-US')} more</div>}
        </div>
      </section>;
    })}
    {deleted.length > 0 && <p className="sf-muted sf-small">No longer in the org, kept locally: {deleted.slice(0, 20).map(row => row.fullName).join(', ')}{deleted.length > 20 ? ` and ${deleted.length - 20} more` : ''}</p>}
  </>;
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
