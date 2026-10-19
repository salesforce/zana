import { useMemo, useRef, useState } from 'react';
import { agentVersion, SYNC_FETCH_MAX, type SyncCheck, type SyncType } from '../../lib/org-sync-contract.js';
import {
  PICK_STATES, PICK_TYPES, agentGroups, isChange, modeKeys, modeLabel, needsAttention, pickRows, replaceType, selectable, typeMode,
  type PickMode, type PickRow,
} from './org-sync-picker.js';

type Focus = SyncType | 'overview';
type Chip = 'all' | 'attention' | PickRow['state'];
export interface PickerPreset { label: string; count?: number; keys: string[] }

/** Rows rendered per list; filters and Select all shown still cover every match. */
const VISIBLE_ROWS = 200;
const BAR_STATES: PickRow['state'][] = ['conflict', 'changed', 'new', 'unknown', 'current', 'deleted'];
const CHIPS: Chip[] = ['all', 'attention', 'conflict', 'changed', 'new', 'unknown', 'current', 'deleted'];

export const PICKER_STYLES = `
.sf-sync.is-picker { width:1180px; height:min(760px, calc(100dvh - 32px)); }
.sf-pick-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:22px 26px 14px; border-bottom:1px solid var(--border); }
.sf-pick-head h2 { margin:0; font-size:21px; font-weight:600; letter-spacing:-.2px; }
.sf-pick-sub { margin-top:4px; color:var(--text-muted); }
.sf-pick-org { display:inline-flex; align-items:center; gap:6px; margin-right:8px; padding:2px 8px; border-radius:999px; background:var(--bg-base); border:1px solid var(--border); font-size:12px; color:var(--text-primary); }
.sf-pick-org::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--success, #2e844a); }
.sf-pick-presets { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
.sf-pick-presets button, .sf-pick-card button, .sf-pick-modes button, .sf-pick-seg button, .sf-pick-chip, .sf-pick-btn { font:inherit; color:var(--text-primary); background:var(--bg-panel); border:1px solid var(--border); cursor:pointer; }
.sf-pick-presets button { border-radius:8px; padding:6px 10px; font-size:13px; }
.sf-pick-presets button:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
.sf-pick-presets button span { color:var(--text-muted); margin-left:4px; }
.sf-pick-body { flex:1; display:grid; grid-template-columns:290px minmax(0,1fr); min-height:0; }
.sf-pick-rail { border-right:1px solid var(--border); background:var(--bg-base); overflow:auto; padding:10px 8px; }
.sf-pick-railtitle { margin:10px 10px 6px; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted); }
.sf-pick-type { display:grid; grid-template-columns:22px minmax(0,1fr); align-items:center; gap:8px; padding:0 10px; border-radius:9px; }
.sf-pick-type:hover { background:color-mix(in srgb, var(--text-primary) 5%, transparent); }
.sf-pick-type.is-on { background:var(--bg-panel); box-shadow:0 0 0 1px var(--border), 0 1px 2px #0000000a; }
.sf-pick-type > button { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; padding:8px 0; border:0; background:none; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.sf-pick-type .sf-pick-name { font-weight:600; }
.sf-pick-type .sf-pick-meta { display:block; margin-top:1px; font-size:12px; color:var(--text-muted); font-weight:400; }
.sf-pick-type .sf-pick-sel { font-size:11px; font-weight:600; color:var(--accent); white-space:nowrap; }
.sf-pick-dot { display:inline-block; min-width:18px; padding:0 5px; margin-left:4px; border-radius:9px; font-size:11px; line-height:16px; text-align:center; font-weight:600; }
.sf-pick-dot.is-changed { background:color-mix(in srgb, #c98a12 16%, transparent); color:#a86a00; }
.sf-pick-dot.is-conflict { background:color-mix(in srgb, var(--danger) 14%, transparent); color:var(--danger); }
.sf-pick input[type=checkbox] { width:16px; height:16px; margin:0; accent-color:var(--accent); cursor:pointer; }
.sf-pick-main { display:flex; flex-direction:column; min-width:0; min-height:0; }
.sf-pick-typehead { display:flex; align-items:center; gap:14px; padding:16px 22px 12px; }
.sf-pick-typehead h3 { margin:0; font-size:17px; }
.sf-pick-typehead > span { color:var(--text-muted); }
.sf-pick-modes { margin-left:auto; display:inline-flex; border:1px solid var(--border); border-radius:9px; overflow:hidden; }
.sf-pick-modes button { border:0; border-right:1px solid var(--border); padding:7px 12px; font-size:13px; color:var(--text-muted); }
.sf-pick-modes button:last-child, .sf-pick-seg button:last-child { border-right:0; }
.sf-pick-modes button[aria-pressed=true], .sf-pick-seg button[aria-pressed=true] { background:color-mix(in srgb, var(--accent) 12%, var(--bg-panel)); color:var(--accent); font-weight:600; }
.sf-pick-tools { display:flex; align-items:center; gap:8px; padding:0 22px 12px; flex-wrap:wrap; }
.sf-pick-search { flex:1; min-width:220px; padding:8px 10px; border:1px solid var(--border); border-radius:9px; font:inherit; color:var(--text-primary); background:var(--bg-panel); }
.sf-pick-search:focus { outline:2px solid color-mix(in srgb, var(--accent) 20%, transparent); border-color:var(--accent); }
.sf-pick-chip { border-radius:999px; padding:5px 10px; font-size:12.5px; color:var(--text-muted); }
.sf-pick-chip[aria-pressed=true] { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 12%, var(--bg-panel)); color:var(--accent); font-weight:600; }
.sf-pick-chip span { margin-left:3px; opacity:.75; }
.sf-pick-match { display:flex; align-items:center; gap:10px; padding:6px 22px; font-size:13px; color:var(--text-muted); background:color-mix(in srgb, var(--accent) 10%, var(--bg-panel)); border-top:1px solid color-mix(in srgb, var(--accent) 20%, transparent); }
.sf-pick-match button { border:0; background:none; color:var(--accent); font:inherit; font-weight:600; cursor:pointer; padding:0; }
.sf-pick-match button:disabled { opacity:.5; cursor:default; }
.sf-pick-list { flex:1; overflow:auto; border-top:1px solid var(--border); }
.sf-pick-row { display:grid; grid-template-columns:22px minmax(0,1fr) 120px 230px; align-items:center; gap:10px; padding:8px 22px; border-bottom:1px solid color-mix(in srgb, var(--border) 60%, transparent); cursor:pointer; }
.sf-pick-row:hover { background:color-mix(in srgb, var(--text-primary) 3%, transparent); }
.sf-pick-row.is-child { padding-left:62px; }
.sf-pick-row.is-off { cursor:default; color:var(--text-muted); }
.sf-pick-nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:13px ui-monospace,SFMono-Regular,Menlo,monospace; }
.sf-pick-who { color:var(--text-muted); font-size:12.5px; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sf-pick-state { justify-self:start; font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:999px; white-space:nowrap; }
.sf-pick-state.is-changed { background:color-mix(in srgb, #c98a12 16%, transparent); color:#a86a00; }
.sf-pick-state.is-conflict, .sf-pick-state.is-deleted { background:color-mix(in srgb, var(--danger) 14%, transparent); color:var(--danger); }
.sf-pick-state.is-new { background:color-mix(in srgb, #7b61e8 14%, transparent); color:#6b4fd8; }
.sf-pick-state.is-unknown { background:var(--bg-base); color:var(--text-muted); border:1px solid var(--border); }
.sf-pick-state.is-current { background:color-mix(in srgb, var(--success, #2e844a) 14%, transparent); color:var(--success, #2e844a); }
.sf-pick-group { display:grid; grid-template-columns:22px 18px minmax(0,1fr) auto; align-items:center; gap:10px; padding:10px 22px; border-bottom:1px solid color-mix(in srgb, var(--border) 60%, transparent); background:color-mix(in srgb, var(--bg-base) 40%, var(--bg-panel)); }
.sf-pick-tw { border:0; background:none; cursor:pointer; color:var(--text-muted); padding:0; font-size:12px; transition:transform .12s; }
.sf-pick-tw[aria-expanded=true] { transform:rotate(90deg); }
.sf-pick-gname { font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-pick-gname small { color:var(--text-muted); font:400 12.5px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; margin-left:8px; }
.sf-pick-seg { display:inline-flex; border:1px solid var(--border); border-radius:7px; overflow:hidden; }
.sf-pick-seg button { border:0; border-right:1px solid var(--border); padding:4px 9px; font-size:12px; color:var(--text-muted); }
.sf-pick-empty { padding:40px; text-align:center; color:var(--text-muted); }
.sf-pick-overview { flex:1; overflow:auto; padding:18px 22px; border-top:1px solid var(--border); }
.sf-pick-cards { display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:12px; }
.sf-pick-card { border:1px solid var(--border); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:8px; }
.sf-pick-card h4 { margin:0; font-size:14px; display:flex; justify-content:space-between; }
.sf-pick-card h4 span { color:var(--text-muted); font-weight:400; }
.sf-pick-card p { margin:0; color:var(--text-muted); font-size:12.5px; flex:1; }
.sf-pick-bar { display:flex; height:6px; border-radius:3px; overflow:hidden; background:var(--bg-base); }
.sf-pick-bar span.is-conflict { background:var(--danger); } .sf-pick-bar span.is-changed { background:#e3a43a; } .sf-pick-bar span.is-new { background:#8f7ae6; }
.sf-pick-bar span.is-unknown { background:color-mix(in srgb, var(--text-muted) 40%, transparent); } .sf-pick-bar span.is-current { background:color-mix(in srgb, var(--success, #2e844a) 60%, transparent); } .sf-pick-bar span.is-deleted { background:color-mix(in srgb, var(--danger) 40%, transparent); }
.sf-pick-card > div:last-child { display:flex; gap:6px; }
.sf-pick-card button { flex:1; border-radius:7px; padding:6px; font-size:12.5px; }
.sf-pick-card button.is-primary { border-color:var(--accent); color:var(--accent); }
.sf-pick-card button:disabled, .sf-pick-presets button:disabled { opacity:.45; cursor:default; }
.sf-pick-notes { margin-top:14px; display:grid; gap:6px; color:var(--text-muted); font-size:12.5px; }
.sf-pick-notes p { margin:0; }
.sf-pick-foot { display:flex; align-items:center; gap:12px; padding:12px 22px; border-top:1px solid var(--border); background:var(--bg-base); }
.sf-pick-tray { flex:1; display:flex; gap:6px; overflow-x:auto; align-items:center; min-height:30px; }
.sf-pick-tray > span:not(.sf-pick-pill) { color:var(--text-muted); font-size:12.5px; white-space:nowrap; }
.sf-pick-pill { display:inline-flex; align-items:center; gap:2px; border-radius:999px; background:var(--bg-panel); border:1px solid var(--border); font-size:12.5px; white-space:nowrap; }
.sf-pick-pill > button { border:0; background:none; font:inherit; color:inherit; cursor:pointer; padding:4px 4px 4px 10px; }
.sf-pick-pill > button:last-child { color:var(--text-muted); font-size:14px; line-height:1; padding:4px 8px 4px 2px; }
.sf-pick-pill > button:last-child:hover { color:var(--danger); }
.sf-pick-remember { display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-muted); white-space:nowrap; }
.sf-pick-btn { border-radius:9px; padding:9px 14px; }
.sf-pick-btn.is-primary { background:var(--accent); border-color:var(--accent); color:var(--bg-panel); font-weight:600; min-width:190px; }
.sf-pick-btn:disabled { opacity:.45; cursor:default; }
/* Fills the dialog while checking, so the footer stays at the bottom as it does once the lists load. */
.sf-pick-status { flex:1; min-height:0; padding:40px 26px; color:var(--text-muted); }
@media (prefers-reduced-motion:reduce) { .sf-pick-tw { transition:none; } }
`;

const when = (at: string | null) => at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, noun: string) => `${count(n)} ${noun}${n === 1 ? '' : 's'}`;
const versionLabel = (row: PickRow) => { const { version } = agentVersion(row.fullName); return version ? `v${version}` : 'working copy'; };

export interface OrgSyncPickerProps {
  title: string;
  titleId: string;
  check: SyncCheck | null;
  status: string;
  error: string;
  busy: boolean;
  selected: Set<string>;
  onSelect(next: Set<string>): void;
  presets: PickerPreset[];
  notes: string[];
  /** Undefined hides Remember. */
  remember?: boolean;
  onRemember(on: boolean): void;
  onCompare(): void;
  onCancel(): void;
}

/** Pick org components by metadata type: a whole type in one click, or cherry-picked rows. */
export function OrgSyncPicker(props: OrgSyncPickerProps) {
  const { check, selected, onSelect } = props;
  const [focus, setFocus] = useState<Focus>('overview');
  const rows = useMemo(() => check ? pickRows(check) : new Map<SyncType, PickRow[]>(), [check]);
  const setMode = (type: SyncType, mode: PickMode) => onSelect(replaceType(selected, type, modeKeys(type, mode, rows.get(type) ?? [])));
  const total = selected.size;
  const label = (type: SyncType) => PICK_TYPES.find(([id]) => id === type)![1];

  return <div className="sf-pick" style={{ display: 'contents' }}>
    <div className="sf-pick-head">
      <div>
        <h2 id={props.titleId}>{props.title}</h2>
        <div className="sf-pick-sub">{check && <span className="sf-pick-org">{check.org.alias}</span>}Nothing is written until you review the changes.</div>
      </div>
      {check && <div className="sf-pick-presets" role="group" aria-label="Quick picks">
        {props.presets.map(preset => <button key={preset.label} type="button" disabled={props.busy || !preset.keys.length} onClick={() => onSelect(new Set(preset.keys))}>
          {preset.label}{preset.count !== undefined && <span>{count(preset.count)}</span>}</button>)}
      </div>}
    </div>
    {!check ? <div className="sf-pick-status" role={props.error ? 'alert' : 'status'}>{props.error || props.status}</div> : <div className="sf-pick-body">
      <nav className="sf-pick-rail" aria-label="Metadata types">
        <div className={`sf-pick-type${focus === 'overview' ? ' is-on' : ''}`}>
          <span aria-hidden="true">◎</span>
          <button type="button" aria-current={focus === 'overview'} onClick={() => setFocus('overview')}><span className="sf-pick-name">Overview</span></button>
        </div>
        <div className="sf-pick-railtitle">Metadata types</div>
        {PICK_TYPES.map(([type, name]) => {
          const list = rows.get(type) ?? [];
          const open = list.filter(selectable);
          const picked = list.filter(row => selected.has(row.key)).length;
          const changed = list.filter(row => row.state === 'changed').length;
          const conflicts = list.filter(row => row.state === 'conflict').length;
          const meta = type === 'AiAuthoringBundle' ? `${plural(agentGroups(list).length, 'agent')} · ${plural(list.length, 'version')}` : `${count(list.length)} in org`;
          return <div key={type} className={`sf-pick-type${focus === type ? ' is-on' : ''}`}>
            <input type="checkbox" aria-label={`All ${name}`} disabled={!open.length || props.busy} checked={open.length > 0 && picked === open.length}
              ref={input => { if (input) input.indeterminate = picked > 0 && picked < open.length; }}
              onChange={() => setMode(type, picked === open.length ? 'none' : 'all')} />
            <button type="button" aria-current={focus === type} onClick={() => setFocus(type)}>
              <span><span className="sf-pick-name">{name}</span>
                {conflicts > 0 && <span className="sf-pick-dot is-conflict" title="Edited in both">{conflicts}</span>}
                {changed > 0 && <span className="sf-pick-dot is-changed" title="Changed in org">{changed}</span>}
                <span className="sf-pick-meta">{meta}</span></span>
              <span className="sf-pick-sel">{modeLabel(type, list, selected)}</span>
            </button>
          </div>;
        })}
      </nav>
      <main className="sf-pick-main">
        {focus === 'overview'
          ? <Overview check={check} rows={rows} busy={props.busy} notes={props.notes} onMode={setMode} onOpen={setFocus} />
          : <TypeList key={focus} type={focus} name={label(focus)} rows={rows.get(focus) ?? []} selected={selected} busy={props.busy} onSelect={onSelect} onMode={mode => setMode(focus, mode)} />}
      </main>
    </div>}
    <div className="sf-pick-foot">
      <div className="sf-pick-tray" aria-label="Selection">
        {total > SYNC_FETCH_MAX ? <span>Fetch at most {count(SYNC_FETCH_MAX)} components at a time.</span>
          : !total ? <span>{check ? 'Nothing selected yet. Pick a type, a quick pick, or cherry-pick components.' : 'Local edits are never overwritten without your choice.'}</span>
          : PICK_TYPES.filter(([type]) => (rows.get(type) ?? []).some(row => selected.has(row.key))).map(([type, name]) => <span key={type} className="sf-pick-pill">
            <button type="button" onClick={() => setFocus(type)}><b>{name}</b> {modeLabel(type, rows.get(type)!, selected)}</button>
            <button type="button" aria-label={`Clear ${name}`} onClick={() => setMode(type, 'none')}>×</button>
          </span>)}
      </div>
      {props.remember !== undefined && check && <label className="sf-pick-remember"><input type="checkbox" checked={props.remember} onChange={event => props.onRemember(event.target.checked)} /> Remember for this project</label>}
      <button type="button" className="sf-pick-btn" onClick={props.onCancel}>Cancel</button>
      <button type="button" className="sf-pick-btn is-primary" disabled={props.busy || !total || total > SYNC_FETCH_MAX} onClick={props.onCompare}>
        {!check && props.busy ? 'Checking…' : total ? `Compare ${count(total)} component${total === 1 ? '' : 's'} →` : 'Compare →'}</button>
    </div>
  </div>;
}

function Overview({ check, rows, busy, notes, onMode, onOpen }: { check: SyncCheck; rows: Map<SyncType, PickRow[]>; busy: boolean; notes: string[]; onMode(type: SyncType, mode: PickMode): void; onOpen(type: SyncType): void }) {
  const types = PICK_TYPES.filter(([type]) => (rows.get(type) ?? []).length);
  return <>
    <div className="sf-pick-typehead"><h3>What's in the org</h3><span>Compared with this project and the last fetch</span></div>
    <div className="sf-pick-overview">
      {!types.length && <p className="sf-pick-empty" role="status">Nothing in the org to fetch.</p>}
      <div className="sf-pick-cards">{types.map(([type, name]) => {
        const list = rows.get(type)!;
        const by = (state: PickRow['state']) => list.filter(row => row.state === state).length;
        const parts = [[by('conflict'), 'edited in both'], [by('changed'), 'changed'], [by('new'), 'only in org'], [by('unknown'), 'not compared'], [by('current'), 'up to date'], [by('deleted'), 'gone from org']] as const;
        const open = list.filter(selectable).length;
        const agents = type === 'AiAuthoringBundle';
        return <section key={type} className="sf-pick-card" aria-label={name}>
          <h4>{name}<span>{count(list.length)}</span></h4>
          <div className="sf-pick-bar" aria-hidden="true">{BAR_STATES.map(state => by(state) > 0 && <span key={state} className={`is-${state}`} style={{ width: `${by(state) / list.length * 100}%` }} />)}</div>
          <p>{parts.filter(([n]) => n).map(([n, text]) => `${count(n)} ${text}`).join(' · ')}</p>
          <div>
            {agents
              ? <button type="button" className="is-primary" disabled={busy || !open} onClick={() => onMode(type, 'latest')}>Latest versions</button>
              : <button type="button" className="is-primary" disabled={busy || !list.some(isChange)} onClick={() => onMode(type, 'changes')}>Changes</button>}
            <button type="button" disabled={busy || !open} onClick={() => onMode(type, 'all')}>All {count(open)}</button>
            <button type="button" onClick={() => onOpen(type)}>Choose…</button>
          </div>
        </section>;
      })}</div>
      {(notes.length > 0 || check.truncated) && <div className="sf-pick-notes">
        {notes.map(note => <p key={note}>{note}</p>)}
        {check.truncated && <p>Showing the first results only.</p>}
      </div>}
    </div>
  </>;
}

function TypeList({ type, name, rows, selected, busy, onSelect, onMode }: { type: SyncType; name: string; rows: PickRow[]; selected: Set<string>; busy: boolean; onSelect(next: Set<string>): void; onMode(mode: PickMode): void }) {
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const agents = type === 'AiAuthoringBundle';
  const groups = useMemo(() => agents ? agentGroups(rows) : [], [agents, rows]);
  const [opened, setOpened] = useState<Set<string>>(() => new Set(groups[0] ? [groups[0].base] : []));
  const last = useRef('');
  const needle = query.trim().toLowerCase();
  const matchChip = (row: PickRow, value: Chip) => value === 'all' || (value === 'attention' ? needsAttention(row) : row.state === value);
  const chipCount = (value: Chip) => rows.filter(row => matchChip(row, value)).length;
  const chips = CHIPS.filter(value => value === 'all' || chipCount(value) > 0);
  const active = chips.includes(chip) ? chip : 'all';
  const visible = rows.filter(row => matchChip(row, active) && row.fullName.toLowerCase().includes(needle));
  const shown = new Set(visible.map(row => row.key));
  const picked = rows.filter(row => selected.has(row.key)).length;
  const mode = typeMode(type, rows, selected);
  const modes: Array<[PickMode, string]> = agents ? [['none', 'None'], ['latest', 'Latest versions'], ['all', 'All versions']] : [['none', 'None'], ['changes', 'Changes'], ['all', 'All']];
  const order = agents ? groups.flatMap(group => group.rows).filter(row => shown.has(row.key)) : visible;
  const keys = order.map(row => row.key);

  const set = (list: string[], on: boolean) => {
    const next = new Set(selected);
    for (const key of list) if (on) next.add(key); else next.delete(key);
    onSelect(next);
  };
  const toggle = (row: PickRow, shift: boolean) => {
    const on = !selected.has(row.key);
    const from = keys.indexOf(last.current), to = keys.indexOf(row.key);
    last.current = row.key;
    if (shift && from >= 0 && to >= 0) {
      const [a, b] = from < to ? [from, to] : [to, from];
      set(order.slice(a, b + 1).filter(selectable).map(item => item.key), on);
    } else set([row.key], on);
  };
  const line = (row: PickRow, child = false) => <label key={row.key} className={`sf-pick-row${child ? ' is-child' : ''}${selectable(row) ? '' : ' is-off'}`}>
    <input type="checkbox" aria-label={row.fullName} checked={selected.has(row.key)} disabled={!selectable(row) || busy}
      onChange={event => toggle(row, Boolean((event.nativeEvent as MouseEvent).shiftKey))} />
    <span className="sf-pick-nm" title={row.fullName}>{row.fullName}</span>
    <span className={`sf-pick-state is-${row.state}`}>{PICK_STATES[row.state]}</span>
    <span className="sf-pick-who">{[row.modifiedBy, when(row.modifiedAt)].filter(Boolean).join(' · ')}</span>
  </label>;

  let list;
  if (!visible.length) list = <p className="sf-pick-empty" role="status">{rows.length ? `No ${name.toLowerCase()} match.` : `No ${name.toLowerCase()} in the org.`}</p>;
  else if (agents) {
    const matching = groups.filter(group => group.rows.some(row => shown.has(row.key)));
    list = <>{matching.slice(0, VISIBLE_ROWS).map(group => {
      const open = group.rows.filter(selectable);
      const taken = group.rows.filter(row => selected.has(row.key)).length;
      const groupMode = !taken ? 'none' : taken === 1 && selected.has(group.latest.key) ? 'latest' : taken === open.length ? 'all' : 'custom';
      const expanded = opened.has(group.base) || Boolean(needle);
      const meta = [`${versionLabel(group.latest)} newest in org`, group.local === null ? 'not in project' : `project has ${group.local ? `v${group.local}` : 'the working copy'}`,
        taken ? `${taken} of ${group.rows.length} picked` : `${group.rows.length} version${group.rows.length === 1 ? '' : 's'}`].join(' · ');
      return <div key={group.base} role="group" aria-label={group.base}>
        <div className="sf-pick-group">
          <input type="checkbox" aria-label={`All versions of ${group.base}`} disabled={!open.length || busy} checked={open.length > 0 && taken === open.length}
            ref={input => { if (input) input.indeterminate = taken > 0 && taken < open.length; }}
            onChange={() => set(open.map(row => row.key), taken < open.length)} />
          <button type="button" className="sf-pick-tw" aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} versions of ${group.base}`}
            onClick={() => setOpened(previous => { const next = new Set(previous); if (next.has(group.base)) next.delete(group.base); else next.add(group.base); return next; })}>▶</button>
          <span className="sf-pick-gname">{group.base}<small>{meta}</small></span>
          <span className="sf-pick-seg" role="group" aria-label={`Versions of ${group.base}`}>
            {(['none', 'latest', 'all'] as const).map(value => <button key={value} type="button" aria-pressed={groupMode === value} disabled={busy || (value !== 'none' && !open.length)}
              onClick={() => { const next = new Set([...selected].filter(key => !group.rows.some(row => row.key === key))); for (const key of value === 'all' ? open.map(row => row.key) : value === 'latest' ? [group.latest.key] : []) next.add(key); onSelect(next); }}>
              {value === 'none' ? 'None' : value === 'latest' ? 'Latest' : 'All'}</button>)}
          </span>
        </div>
        {expanded && group.rows.filter(row => shown.has(row.key)).map(row => line(row, true))}
      </div>;
    })}{matching.length > VISIBLE_ROWS && <p className="sf-pick-empty">and {(matching.length - VISIBLE_ROWS).toLocaleString('en-US')} more agents · filter to narrow</p>}</>;
  } else list = <>{visible.slice(0, VISIBLE_ROWS).map(row => line(row))}
    {visible.length > VISIBLE_ROWS && <p className="sf-pick-empty">and {(visible.length - VISIBLE_ROWS).toLocaleString('en-US')} more · filter to narrow</p>}</>;

  const filtered = Boolean(needle) || active !== 'all';
  const openShown = visible.filter(selectable);
  return <>
    <div className="sf-pick-typehead">
      <h3>{name}</h3><span>{count(picked)} of {count(rows.length)} selected</span>
      <span className="sf-pick-modes" role="group" aria-label={`Select ${name}`}>
        {modes.map(([value, text]) => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => onMode(value)}>{text}</button>)}
      </span>
    </div>
    <div className="sf-pick-tools">
      <input type="search" className="sf-pick-search" aria-label={`Filter ${name}`} placeholder={`Filter ${name.toLowerCase()} by name`} value={query} onChange={event => setQuery(event.target.value)} />
      {chips.map(value => <button key={value} type="button" className="sf-pick-chip" aria-pressed={active === value} onClick={() => setChip(value)}>
        {value === 'all' ? 'All' : value === 'attention' ? 'Needs attention' : PICK_STATES[value]}<span>{count(chipCount(value))}</span></button>)}
    </div>
    {filtered && visible.length > 0 && <div className="sf-pick-match" role="status">{count(visible.length)} shown ·
      <button type="button" disabled={busy || openShown.every(row => selected.has(row.key))} onClick={() => set(openShown.map(row => row.key), true)}>Select all {count(openShown.length)} shown</button>
      <button type="button" disabled={busy || !visible.some(row => selected.has(row.key))} onClick={() => set(visible.map(row => row.key), false)}>Clear shown</button>
    </div>}
    <div className="sf-pick-list">{list}</div>
  </>;
}
