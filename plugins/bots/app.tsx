import { PopoverPicklist } from '@zana-ai/zcc-ui/popover-picklist';
import { BotMemory } from './src/BotMemory.js';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { definePluginApp, useRealtime, useRpc, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { BOT_COLORS, botMemoryTag, defaultBotColor, defaultBotShape, describeCron, type BotRoutine, type BotShape } from './src/model.js';
import type { BotJobView, BotView } from './src/service.js';

const CHANNEL = 'bots:changed';
type BotState = 'new' | 'working' | 'asleep' | 'missing' | 'unknown';

const muted: CSSProperties = { color: 'var(--text-muted)' };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function botState(bot: BotView): BotState {
  if (!bot.mainThreadId) return 'new';
  if (!bot.mainThreadStatus) return 'missing';
  if (bot.mainThreadStatus === 'unknown') return 'unknown';
  if (bot.mainThreadStatus === 'active' || bot.mainThreadStatus === 'starting' || bot.activeJobs > 0) return 'working';
  return 'asleep';
}

const STATE_LABEL: Record<BotState, string> = { new: 'Not started', working: 'Working', asleep: 'Asleep', missing: 'Thread missing', unknown: 'Status unavailable' };
const COLOR_NAMES = ['Blue', 'Orange', 'Green', 'Purple', 'Red', 'Yellow', 'Pink', 'Teal'];
const NOTICE_MS = 4_000;

/** Panel layout and bot identity. Form controls inherit Zana’s settings-field styles. */
const CSS = `
.bt-root{container-type:inline-size;line-height:1.5;background:var(--bg-panel);display:flex;height:100%;min-height:0;font-size:13px;color:var(--text-primary)}
.bt-layout{display:grid;width:100%;min-height:0;grid-template-columns:170px minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
.bt-root button{font:inherit;color:inherit}
.bt-root :focus-visible{outline:2px solid var(--accent-blue);outline-offset:2px}
.bt-list{min-width:0;background:var(--bg-base);border-right:1px solid var(--border);padding:8px;overflow:auto;display:flex;flex-direction:column;gap:2px}
.bt-list-head{display:flex;align-items:center;justify-content:space-between;padding:4px 4px 8px}
.bt-list-head h1{font-size:13px;font-weight:600;margin:0}
.bt-item{width:100%;display:flex;gap:10px;align-items:center;text-align:left;padding:7px 8px;border:0;background:transparent;border-radius:8px;cursor:pointer}
.bt-item:hover{background:var(--bg-hover)}
.bt-item[aria-current="true"]{background:var(--bg-elevated)}
.bt-item .bt-name{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-item small{color:var(--text-muted);font-size:11px}
.bt-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px;vertical-align:1px;background:var(--text-dim,#6e7681)}
.bt-dot[data-state="working"]{background:var(--success,#3fb950);box-shadow:0 0 0 3px color-mix(in srgb,var(--success,#3fb950) 20%,transparent)}
.bt-dot[data-state="missing"],.bt-dot[data-state="unknown"]{background:var(--accent-gold,#d4a017)}
.bt-main{min-height:0;flex:1;min-width:0;overflow:auto}
.bt-inner{padding:22px clamp(16px,3%,40px) 48px}
.bt-hero{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.bt-hero-text{flex:1;min-width:180px}
.bt-hero h2{margin:0;font-size:23px;letter-spacing:-.035em;font-weight:600}
.bt-hero p{margin:2px 0 0;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bt-actions{display:flex;gap:6px}
.bt-chips{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.bt-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--bg-elevated);color:var(--text-muted);border:1px solid var(--border)}
.bt-chip.is-warn{color:var(--warning,var(--text-muted));background:transparent;border:0;padding:0}
.bt-tabs{display:flex;gap:16px;margin-top:18px;border-bottom:1px solid var(--border)}
.bt-tabs button{border:0;background:transparent;padding:8px 0;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.bt-tabs button[aria-selected="true"]{color:var(--text-primary);border-bottom-color:var(--accent-blue);font-weight:500}
.bt-sec{margin-top:18px}
.bt-sec h3{font-size:15px;font-weight:600;margin:0}
.bt-card{border:1px solid var(--border);border-radius:8px;background:var(--bg-panel)}
.bt-row{display:flex;align-items:center;gap:12px;padding:10px 12px;width:100%;box-sizing:border-box}
.bt-row+.bt-row,.bt-row+form,.bt-card>p+.bt-row{border-top:1px solid var(--border)}
button.bt-row{border:0;background:transparent;text-align:left;cursor:pointer}
button.bt-row:hover{background:var(--bg-hover)}
.bt-row+button.bt-row{border-top:1px solid var(--border)}
.bt-grow{flex:1;min-width:0}
.bt-sub{display:block;font-size:12px;color:var(--text-muted)}
 .bt-rowacts{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.bt-row.is-routine{flex-wrap:wrap}
.bt-when{text-align:right;font-size:12px;color:var(--text-muted)}
.bt-row.is-routine .bt-grow{flex:1 1 130px}
.bt-ico{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;flex:none;background:var(--bg-elevated);color:var(--text-muted);font-size:12px}
.bt-btn{border:1px solid var(--border);background:var(--bg-panel);border-radius:6px;padding:4px 10px;cursor:pointer;white-space:nowrap}
.bt-btn:hover:not(:disabled){background:var(--bg-hover)}
.bt-btn:disabled{opacity:.5;cursor:default}
.bt-btn.is-primary{background:var(--accent-blue);border-color:var(--accent-blue);color:#fff}
.bt-btn.is-ghost{border-color:transparent;background:transparent}
.bt-btn.is-danger{color:var(--danger,#f85149)}
.bt-btn.is-sm{padding:2px 8px;font-size:12px}
.bt-sw{width:30px;height:18px;border-radius:999px;border:0;background:var(--border-strong,#4a4c57);position:relative;cursor:pointer;flex:none;padding:0}
.bt-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.bt-sw[aria-checked="true"]{background:var(--accent-blue)}
.bt-sw[aria-checked="true"]::after{left:14px}
.bt-sw:disabled{cursor:progress;opacity:.7}
.bt-field>.bt-picker{width:100%;margin-top:4px}
.bt-field{display:block;margin-top:10px;color:var(--text-muted);font-size:12px}
.bt-field input,.bt-field textarea,.bt-field select{display:block;width:100%;margin-top:4px;font-size:13px}
.bt-colors{display:flex;gap:6px}
.bt-colors button{width:16px;height:16px;border-radius:50%;border:0;cursor:pointer;padding:0}
.bt-colors button[aria-checked="true"]{box-shadow:0 0 0 2px var(--bg-panel),0 0 0 3.5px var(--text-primary)}
.bt-colors.is-lg button{width:20px;height:20px}
.bt-note{font-size:12px;color:var(--text-muted);margin:6px 0 0}
.bt-alert{font-size:12px;color:var(--danger,#f85149);margin:6px 0 0}
.bt-start{margin-top:18px;padding:14px;border:1px dashed var(--border-strong,var(--border));border-radius:8px}
.bt-start textarea{width:100%;min-height:72px;margin-top:8px}
.bt-create{max-width:520px;margin:0 auto;padding:28px 20px}
.bt-empty{padding:24px;color:var(--text-muted)}
.bt-av{position:relative;display:inline-block;flex:none}
.bt-av svg{display:block;overflow:visible}
.bt-av g{transform-box:view-box}
.bt-av .bt-body{transform-origin:50px 86px}
.bt-av .bt-blink{transform-origin:50px 46px}
.bt-av.is-live .bt-body,.bt-item:is(:hover,:focus-visible) .bt-av .bt-body{animation:bt-wobble 2.6s ease-in-out infinite}
.bt-av.is-live[data-state="working"] .bt-body,.bt-item:is(:hover,:focus-visible) .bt-av[data-state="working"] .bt-body{animation:bt-hop .9s ease-in-out infinite}
.bt-av.is-live[data-state="asleep"] .bt-body,.bt-item:is(:hover,:focus-visible) .bt-av[data-state="asleep"] .bt-body{animation:bt-breathe 3s ease-in-out infinite}
.bt-av.is-live .bt-look,.bt-item:is(:hover,:focus-visible) .bt-av .bt-look{animation:bt-look 5s ease-in-out infinite}
.bt-av.is-live .bt-blink,.bt-item:is(:hover,:focus-visible) .bt-av .bt-blink{animation:bt-blink 3.8s infinite}
@keyframes bt-wobble{0%,100%{transform:rotate(0)}25%{transform:translateX(-3px) rotate(-7deg)}50%{transform:translateY(-3px)}75%{transform:translateX(3px) rotate(7deg)}}
@keyframes bt-hop{0%,100%{transform:translateY(0) scale(1)}45%{transform:translateY(-7px) scale(.98,1.03)}80%{transform:translateY(0) scale(1.04,.96)}}
@keyframes bt-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.045,.92)}}
@keyframes bt-look{0%,22%,100%{transform:translate(0,0)}30%,48%{transform:translate(6px,-1px)}56%,74%{transform:translate(-5px,1px)}}
@keyframes bt-blink{0%,90%,100%{transform:scaleY(1)}94%{transform:scaleY(.1)}}
@media (prefers-reduced-motion:reduce){.bt-av *{animation:none!important}}
.bt-topline,.bt-section-head,.bt-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bt-section-head{justify-content:space-between;margin:0 0 8px}
.bt-topline{border-bottom:1px solid var(--border);padding:9px 24px;color:var(--text-muted);font-size:12px}
.bt-meta{font-size:12px;color:var(--text-muted)}
#bot-panel-settings{max-width:720px}
#bot-panel-settings .bt-card{border:0}
#bot-panel-settings .bt-row{padding:12px 0}
#bot-panel-settings .bt-row :is(input,select,textarea,.bt-picker){width:min(55%,310px);box-sizing:border-box}
.bt-root .bt-field :is(input,select,textarea),.bt-start textarea{box-sizing:border-box}
.bt-sec .bt-memory{padding:10px 14px}
.bt-memory+.bt-memory{border-top:1px solid var(--border)}
.bt-memory summary{cursor:pointer}.bt-memory p{white-space:pre-wrap;overflow-wrap:anywhere}
.bt-empty-line{margin:0;padding:12px;color:var(--text-muted)}
.bt-grow,.bt-hero-text,.bt-memory{overflow-wrap:anywhere}
.bt-root .settings-field{margin-bottom:0}
@container (max-width:700px){.bt-layout{grid-template-columns:135px minmax(0,1fr)}.bt-list-head{flex-wrap:wrap}.bt-when{text-align:left}.bt-row.is-routine .bt-grow{flex-basis:55%}}
@container (max-width:520px){.bt-layout{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.bt-root .bt-list{max-height:110px;flex-direction:row;align-items:center;overflow:auto;border-right:0;border-bottom:1px solid var(--border)}.bt-list .bt-item{width:auto;flex:none}.bt-list-head{flex:none;gap:4px}.bt-inner{padding:16px 12px 32px}.bt-row{flex-wrap:wrap}#bot-panel-settings .bt-row :is(input,select,textarea,.bt-picker){width:100%}.bt-colors{flex-wrap:wrap}}
.bt-root code{font-size:12px}
`;

const BODY: Record<BotShape, ReactNode> = {
  blob: <path d="M50 14c20 0 34 14 34 34 0 6 2 10 2 16 0 14-14 22-36 22S14 78 14 64c0-6 2-10 2-16 0-20 14-34 34-34z" />,
  cloud: (
    <>
      <circle cx={38} cy={50} r={20} /><circle cx={61} cy={43} r={22} /><circle cx={73} cy={62} r={15} />
      <circle cx={28} cy={64} r={15} /><rect x={28} y={54} width={46} height={26} rx={13} />
    </>
  ),
  hexagon: <polygon points="50,17 79,34 79,66 50,83 21,66 21,34" strokeWidth={14} strokeLinejoin="round" />,
  round: <circle cx={50} cy={52} r={34} />,
};

/**
 * Grok-style avatar: a colored body (shape picked per bot), eyes that blink and look around,
 * closed while the bot sleeps. `live` animates it always; otherwise it animates on list-row hover.
 */
export function BotAvatar({ bot, size = 40, live = false }: { bot: BotView; size?: number; live?: boolean }) {
  const state = botState(bot);
  const color = bot.color ?? defaultBotColor(bot.id);
  const shape = defaultBotShape(bot.id);
  const asleep = state === 'asleep';
  const eye = state === 'working' ? 16 : 14;
  return (
    <span className={`bt-av${live ? ' is-live' : ''}`} style={{ width: size, height: size }} data-state={state} data-shape={shape} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 100 100">
        <g className="bt-body">
          <g style={{ fill: color, stroke: color }} strokeWidth={0}>{BODY[shape]}</g>
          {asleep ? (
            <path d="M36 52q5 4 10 0M56 52q5 4 10 0" stroke="#fff" strokeWidth={4} fill="none" strokeLinecap="round" />
          ) : (
            <g className="bt-look">
              <g className="bt-blink">
                <rect x={38} y={38} width={7} height={eye} rx={3.5} fill="#fff" transform="rotate(-8 41 45)" />
                <rect x={55} y={38} width={7} height={eye} rx={3.5} fill="#fff" transform="rotate(-8 58 45)" />
              </g>
            </g>
          )}
        </g>
      </svg>
    </span>
  );
}

function Section({ label, children, action }: { label: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="bt-sec" aria-label={label}>
      <div className="bt-section-head"><h3>{label}</h3>{action}</div>
      <div className="bt-card">{children}</div>
    </section>
  );
}

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange(next: boolean): void }) {
  return <button type="button" className="bt-sw" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** Arrow keys move between sibling items (tabs, radios) and select the focused one. */
function arrowNav(event: KeyboardEvent<HTMLElement>, count: number, index: number, pick: (next: number) => void): void {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : step ? (index + step + count) % count : -1;
  if (next < 0) return;
  event.preventDefault();
  pick(next);
  const items = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"],[role="radio"]');
  items?.[next]?.focus();
}

/** One RPC action with its own busy flag and feedback, shown next to the control that ran it. */
function useAction(botId: string) {
  const rpc = useRpc();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const run = useCallback(async (method: string, args: Record<string, unknown>, done?: string) => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await rpc.call(method, { bot: botId, ...args });
      if (done) setNotice(done);
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [rpc, botId]);
  const feedback = (
    <>
      {error && <span role="alert" className="bt-alert" style={{ display: 'block' }}>{error}</span>}
      {notice && <span role="status" className="bt-note" style={{ display: 'block' }}>{notice}</span>}
    </>
  );
  return { run, busy, feedback, clearError: () => setError('') };
}

export function BotsPanel() {
  const rpc = useRpc();
  const [bots, setBots] = useState<BotView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const rows = (await rpc.call('list')) as BotView[];
      if (mine !== seq.current) return;
      setBots(rows);
      setSelected((current) => (current && rows.some((bot) => bot.id === current) ? current : rows[0]?.id ?? null));
      setError('');
    } catch (err) {
      if (mine === seq.current) setError(message(err));
    } finally {
      if (mine === seq.current) setLoaded(true);
    }
  }, [rpc]);

  useEffect(() => void refresh(), [refresh]);
  useRealtime(CHANNEL, () => void refresh());

  const bot = bots.find((row) => row.id === selected) ?? null;
  const showCreate = creating || (loaded && bots.length === 0);

  return (
    <div className="bt-root">
      <style>{CSS}</style>
      <div className="bt-layout">
        <nav className="bt-list" aria-label="Bots">
          <div className="bt-list-head">
            <h1>Bots</h1>
            <button type="button" className="bt-btn is-ghost is-sm" onClick={() => setCreating(true)}>＋ New bot</button>
          </div>
          {error && <p role="alert" className="bt-alert">{error}</p>}
          {bots.map((row) => {
            const active = row.id === selected && !showCreate;
            const routines = row.routines.filter((r) => r.enabled).length;
            const state = botState(row);
            return (
              <button key={row.id} type="button" className="bt-item" aria-current={active ? 'true' : undefined}
                onClick={() => { setSelected(row.id); setCreating(false); }}>
                <BotAvatar bot={row} size={30} live={active} />
                <span style={{ minWidth: 0 }}>
                  <span className="bt-name">{row.name}</span>
                  <small>
                    <span className="bt-dot" data-state={state} />
                    {STATE_LABEL[state]}
                    {routines ? ` · ${routines} routine${routines === 1 ? '' : 's'}` : ''}
                    {row.activeJobs ? ` · ${row.activeJobs} job${row.activeJobs === 1 ? '' : 's'}` : ''}
                  </small>
                </span>
              </button>
            );
          })}
        </nav>
        <main className="bt-main">
          {showCreate ? (
            <CreateBot
              canCancel={bots.length > 0}
              onCancel={() => setCreating(false)}
              onCreated={(id) => { setCreating(false); setSelected(id); void refresh(); }}
            />
          ) : bot ? (
            <BotPage key={bot.id} bot={bot} onDeleted={() => { setSelected(null); void refresh(); }} />
          ) : (
            <p role="status" className="bt-empty">{loaded ? '' : 'Loading bots…'}</p>
          )}
        </main>
      </div>
    </div>
  );
}

function CreateBot(props: { canCancel: boolean; onCancel(): void; onCreated(id: string): void }) {
  const rpc = useRpc();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(BOT_COLORS[0]);
  const [personality, setPersonality] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const edit = (setter: (value: string) => void) => (e: { target: { value: string } }) => { setter(e.target.value); setError(''); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const bot = (await rpc.call('create', { name, color, personality })) as { id: string };
      props.onCreated(bot.id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  const preview = { id: 'preview', name: name || 'New bot', color, routines: [], activeJobs: 0, mainThreadStatus: null } as unknown as BotView;
  return (
    <form className="bt-create" onSubmit={(event) => void submit(event)} aria-label="Create a bot">
      <div className="bt-hero">
        <BotAvatar bot={preview} size={64} live />
        <div className="bt-hero-text">
          <h2>Create a bot</h2>
          <p>One persistent thread with a personality. Anyone can message it, routines wake it on a schedule, and it runs heavy work in hidden background jobs.</p>
        </div>
      </div>
      <div className="bt-chips"><span className="bt-chip is-warn" title="Bots run without asking for approval">Full access</span></div>
      <label className="bt-field settings-field">Name<input value={name} onChange={edit(setName)} placeholder="Release Scout" /></label>
      <div className="bt-field settings-field">Color<div style={{ marginTop: 6 }}><ColorPicker value={color} onChange={setColor} large /></div></div>
      <label className="bt-field settings-field">
        Personality and role
        <textarea rows={5} value={personality} onChange={edit(setPersonality)}
          placeholder="You watch our release branches, summarize what changed each morning, and flag risky merges." />
      </label>
      {error && <p role="alert" className="bt-alert">{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="submit" className="bt-btn is-primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create bot'}</button>
        {props.canCancel && <button type="button" className="bt-btn" onClick={props.onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function ColorPicker({ value, disabled, large, onChange }: { value: string; disabled?: boolean; large?: boolean; onChange(color: string): void }) {
  const current = BOT_COLORS.indexOf(value as (typeof BOT_COLORS)[number]);
  return (
    <div role="radiogroup" aria-label="Color" className={large ? 'bt-colors is-lg' : 'bt-colors'}>
      {BOT_COLORS.map((color, index) => {
        const checked = color === value;
        return (
          <button key={color} type="button" role="radio" aria-checked={checked} aria-label={COLOR_NAMES[index]} disabled={disabled}
            tabIndex={checked || (current < 0 && index === 0) ? 0 : -1}
            onClick={() => onChange(color)}
            onKeyDown={(event) => arrowNav(event, BOT_COLORS.length, index, (next) => onChange(BOT_COLORS[next]!))}
            style={{ background: color }} />
        );
      })}
    </div>
  );
}

/**
 * Show the bot's main thread in the host side panel; on hosts without one
 * (older hosts, nested tools) open the thread page instead.
 */
function useOpenChat() {
  const navigate = useZccNavigate();
  return useCallback((bot: Pick<BotView, 'name'>, threadId: string) => {
    if (navigate.openPanelAgent?.({ threadId, title: bot.name })) return;
    navigate.toThread(threadId);
  }, [navigate]);
}

const TABS = [['details', 'Overview'], ['library', 'Library'], ['settings', 'Settings']] as const;
type Tab = (typeof TABS)[number][0];
const WAKE_MESSAGE = 'Check in: anything new since your last run? Reply in a few lines.';

function BotPage({ bot, onDeleted }: { bot: BotView; onDeleted(): void }) {
  const [tab, setTab] = useState<Tab>('details');
  const openChat = useOpenChat();
  const wake = useAction(bot.id);
  const catalog = useCatalog(bot.providerId ?? '');
  const jobs = useJobs(bot.id);
  const state = botState(bot);
  const hasThread = Boolean(bot.mainThreadId) && (state === 'working' || state === 'asleep');
  const projectName = catalog.data?.projects.find((row) => row.id === bot.projectId)?.name ?? (catalog.data || catalog.error ? bot.projectId : '…');

  return (
    <>
      <div className="bt-topline">Bots <span aria-hidden="true">/</span> {bot.name}</div>
      <div className="bt-inner">
      <header className="bt-hero">
        <BotAvatar bot={bot} size={44} live />
        <div className="bt-hero-text">
          <div className="bt-title"><h2>{bot.name}</h2>
            <span className="bt-chip"><span className="bt-dot" data-state={state} />{STATE_LABEL[state]}
              {bot.activeJobs ? ` · ${bot.activeJobs} background job${bot.activeJobs === 1 ? '' : 's'}` : ''}</span>
          </div>
          <span className="bt-meta">{projectName} · <span className="bt-chip is-warn" title="Bots run without asking for approval">Full access</span></span>
        </div>
        <div className="bt-actions">
          {hasThread && (
            <button type="button" className="bt-btn is-primary" onClick={() => openChat(bot, bot.mainThreadId!)}>Chat</button>
          )}
          {state === 'asleep' && (
            <button type="button" className="bt-btn" disabled={wake.busy}
              onClick={() => void wake.run('send', { message: WAKE_MESSAGE }, `${bot.name} is waking up`)}>Wake</button>
          )}
        </div>
      </header>
      {wake.feedback}
      <div role="tablist" aria-label={`${bot.name} sections`} className="bt-tabs">
        {TABS.map(([id, label], index) => (
          <button key={id} id={`bot-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`bot-panel-${id}`}
            tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}
            onKeyDown={(event) => arrowNav(event, TABS.length, index, (next) => setTab(TABS[next]![0]))}>
            {label}
          </button>
        ))}
      </div>
      {/* Every panel stays mounted so unsaved edits and scroll survive a tab switch. */}
      <div role="tabpanel" id="bot-panel-details" aria-labelledby="bot-tab-details" hidden={tab !== 'details'}>
        {!hasThread && <StartConversation bot={bot} state={state} onStarted={(threadId) => openChat(bot, threadId)} />}
        <Details bot={bot} jobs={jobs} openLibrary={() => setTab('library')} visible={tab === 'details'} />
      </div>
      <div role="tabpanel" id="bot-panel-library" aria-labelledby="bot-tab-library" hidden={tab !== 'library'}>
        <Library bot={bot} jobsState={jobs} visible={tab === 'library'} />
      </div>
      <div role="tabpanel" id="bot-panel-settings" aria-labelledby="bot-tab-settings" hidden={tab !== 'settings'}>
        <Settings bot={bot} onDeleted={onDeleted} />
      </div>
    </div></>
  );
}

function StartConversation({ bot, state, onStarted }: { bot: BotView; state: BotState; onStarted(threadId: string): void }) {
  const rpc = useRpc();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (state === 'unknown') {
    return <p role="status" className="bt-start bt-note">Can&apos;t reach {bot.name}&apos;s thread right now. It will reappear when the host responds.</p>;
  }
  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = (await rpc.call('send', { bot: bot.id, message: text })) as { threadId?: string } | null;
      setText('');
      if (result?.threadId) onStarted(result.threadId);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="bt-start settings-field" aria-label={`Start ${bot.name}`} onSubmit={(event) => void start(event)}>
      <span className="bt-note" style={{ margin: 0 }}>
        {state === 'missing'
          ? `${bot.name}'s main thread was deleted. Your next message starts a fresh main thread; routines and memory are kept.`
          : `${bot.name} has no thread yet. The first message wakes it up and opens the chat beside this page.`}
      </span>
      <textarea aria-label={`Message ${bot.name}`} value={text}
        onChange={(e) => { setText(e.target.value); setError(''); }} placeholder="Introduce yourself and tell me what you can do." />
      {error && <p role="alert" className="bt-alert">{error}</p>}
      <button type="submit" className="bt-btn is-primary" disabled={busy || !text.trim()} style={{ marginTop: 8 }}>{busy ? 'Starting…' : 'Start conversation'}</button>
    </form>
  );
}

function Details({ bot, jobs, openLibrary, visible }: {
  bot: BotView; jobs: ReturnType<typeof useJobs>; openLibrary(): void; visible: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [nextRuns, setNextRuns] = useState<Record<string, number | null>>({});
  const rpc = useRpc();
  const scheduleKey = JSON.stringify(bot.routines.map(r => [r.id, r.enabled, r.cron]));
  useEffect(() => {
    if (!visible || !bot.routines.length) return;
    let seq = 0;
    const refresh = async () => {
      const request = ++seq;
      try {
        const forecast = await rpc.call('nextRuns', { bot: bot.id });
        if (request === seq) setNextRuns(forecast as Record<string, number | null>);
      } catch { if (request === seq) setNextRuns({}); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => { seq++; clearInterval(timer); };
  }, [rpc, bot.id, scheduleKey, visible]);
  const openChat = useOpenChat();
  const activity = [
    ...bot.routines.filter(r => r.lastRunAt).map(r => ({ key: 'routine-' + r.id, name: r.name, at: r.lastRunAt!, detail: 'Routine ran', threadId: bot.mainThreadId, title: bot.name })),
    ...(jobs.jobs ?? []).map(j => ({ key: 'job-' + j.threadId, name: j.title, at: j.startedAt, detail: j.archived ? 'Archived job' : 'Job · ' + j.status, threadId: j.threadId, title: j.title }))
  ].sort((a, b) => b.at - a.at).slice(0, 5);
  return <>
    <Section label="Routines" action={!adding && <button className="bt-btn is-sm" onClick={() => setAdding(true)}>＋ Add routine</button>}>
      {bot.routines.map(routine => <RoutineRow key={routine.id} bot={bot} routine={routine} nextRun={nextRuns[routine.id]} />)}
      {!adding && !bot.routines.length && <p className="bt-empty-line">No routines scheduled.</p>}
      {adding && <AddRoutine bot={bot} onDone={() => setAdding(false)} />}
    </Section>
    <Section label="Recent activity" action={<button className="bt-btn is-ghost is-sm" onClick={openLibrary}>Open library →</button>}>
      {jobs.error && <p className="bt-empty-line">Couldn’t load job activity. {jobs.error}</p>}
      {!activity.length && !jobs.error && <p className="bt-empty-line">{jobs.jobs ? 'No recent activity.' : 'Loading activity…'}</p>}
      {visible && activity.map(row => <button className="bt-row" key={row.key} disabled={!row.threadId}
        onClick={() => row.threadId && openChat({ name: row.title }, row.threadId)}>
        <span className="bt-grow">{row.name}<span className="bt-sub">{row.detail}</span></span>
        <time className="bt-sub" dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleString()}</time>
      </button>)}
    </Section>
  </>;
}

function RoutineRow({ bot, routine, nextRun }: { bot: BotView; routine: BotRoutine; nextRun?: number | null }) {
  const action = useAction(bot.id);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setEnabled(routine.enabled), [routine.enabled]);
  const labelId = `routine-${bot.id}-${routine.id}`;
  const toggle = async (next: boolean) => {
    setEnabled(next);
    if (!(await action.run('updateRoutine', { routineId: routine.id, patch: { enabled: next } }))) setEnabled(!next);
  };
  return (
    <div role="group" aria-labelledby={labelId} className="bt-row is-routine">
      <span className="bt-ico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg></span>
      <span className="bt-grow">
        <span id={labelId}>{routine.name}</span>
        <span className="bt-sub">
          {describeCron(routine.cron)} · {routine.lastRunAt ? `last ${new Date(routine.lastRunAt).toLocaleString()}` : 'never run'}
        </span>
        {action.feedback}
      </span>
      {enabled && nextRun && <span className="bt-when">Next run<span className="bt-sub">{new Date(nextRun).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></span>}
      <span className={confirming || action.busy ? 'bt-rowacts is-pinned' : 'bt-rowacts'}>
        {confirming ? (
          <>
            <button type="button" className="bt-btn is-sm is-danger" disabled={action.busy}
              onClick={() => void action.run('removeRoutine', { routineId: routine.id })}>Delete {routine.name}</button>
            <button type="button" className="bt-btn is-ghost is-sm" onClick={() => setConfirming(false)}>Keep</button>
          </>
        ) : (
          <>
            <button type="button" className="bt-btn is-sm" disabled={action.busy}
              onClick={() => void action.run('runRoutine', { routineId: routine.id }, `Ran ${routine.name}`)}>Run now</button>
            <button type="button" className="bt-btn is-ghost is-sm" aria-label={`More actions for ${routine.name}`} aria-expanded={false} onClick={() => setConfirming(true)}>•••</button>
          </>
        )}
      </span>
      <Switch on={enabled} label={`Enable ${routine.name}`} disabled={action.busy} onChange={(next) => void toggle(next)} />
    </div>
  );
}

type Frequency = 'weekdays' | 'daily' | 'weekly' | 'hourly' | 'custom';
const FREQUENCIES: Array<[Frequency, string]> = [['weekdays', 'Weekdays'], ['daily', 'Every day'], ['weekly', 'Weekly'], ['hourly', 'Hourly'], ['custom', 'Custom cron']];

export function cronFor(freq: Frequency, time: string, day: string, custom: string, minuteOfHour = '0'): string {
  const [hour, minute] = /^\d{1,2}:\d{2}$/.test(time) ? time.split(':').map(Number) as [number, number] : [9, 0];
  if (freq === 'weekdays') return `${minute} ${hour} * * 1-5`;
  if (freq === 'daily') return `${minute} ${hour} * * *`;
  if (freq === 'weekly') return `${minute} ${hour} * * ${day}`;
  if (freq === 'hourly') {
    const at = Number(minuteOfHour);
    return `${Number.isInteger(at) && at >= 0 && at <= 59 ? at : 0} * * * *`;
  }
  return custom.trim();
}

function AddRoutine({ bot, onDone }: { bot: BotView; onDone(): void }) {
  const action = useAction(bot.id);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [freq, setFreq] = useState<Frequency>('weekdays');
  const [time, setTime] = useState('08:00');
  const [minute, setMinute] = useState('0');
  const [day, setDay] = useState('1');
  const [custom, setCustom] = useState('0 9 * * 1-5');
  const cron = cronFor(freq, time, day, custom, minute);
  const edit = (setter: (value: string) => void) => (e: { target: { value: string } }) => { setter(e.target.value); action.clearError(); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await action.run('addRoutine', { routine: { name, cron, prompt } })) onDone();
  };

  return (
    <form aria-label="Add routine" onSubmit={(event) => void submit(event)} style={{ padding: '4px 12px 12px', borderTop: bot.routines.length ? '1px solid var(--border)' : 'none' }}>
      <label className="bt-field settings-field">Name<input value={name} onChange={edit(setName)} placeholder="Morning digest" /></label>
      <div className="bt-field settings-field">When
        <PopoverPicklist ariaLabel="When" className="bt-picker" value={freq}
          options={FREQUENCIES.map(([value, label]) => ({ value, label }))}
          onChange={setFreq} searchPlaceholder="Search frequencies" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {freq === 'hourly' && (
          <label className="bt-field settings-field" style={{ flex: 1 }}>Minute past the hour<input type="number" min={0} max={59} value={minute} onChange={edit(setMinute)} /></label>
        )}
        {freq !== 'custom' && freq !== 'hourly' && (
          <label className="bt-field settings-field" style={{ flex: 1 }}>Around<input type="time" value={time} onChange={edit(setTime)} /></label>
        )}
        {freq === 'weekly' && (
          <div className="bt-field settings-field" style={{ flex: 1 }}>Day
            <PopoverPicklist ariaLabel="Day" className="bt-picker" value={day}
              options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, index) => ({ value: String(index), label }))}
              onChange={setDay} searchPlaceholder="Search days" />
          </div>
        )}
        {freq === 'custom' && (
          <label className="bt-field settings-field" style={{ flex: 1 }}>Cron (minute hour day month weekday)<input value={custom} onChange={edit(setCustom)} /></label>
        )}
      </div>
      <label className="bt-field settings-field">
        What should it do?
        <textarea rows={3} value={prompt} onChange={edit(setPrompt)}
          placeholder="Summarize what changed since yesterday and flag anything that needs me." />
      </label>
      <p className="bt-note">Runs: {describeCron(cron)} (host local time, at most every 15 minutes)</p>
      {action.feedback}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="submit" className="bt-btn is-primary is-sm" disabled={action.busy || !name.trim() || !prompt.trim()}>{action.busy ? 'Adding…' : 'Add routine'}</button>
        <button type="button" className="bt-btn is-ghost is-sm" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

interface Catalog {
  projects: Array<{ id: string; name: string }>;
  providers: Array<{ id: string; name: string }>;
  models: string[];
  modelError: string | null;
}

/** Host projects, providers and the provider's models; reloaded when the provider changes. */
function useCatalog(providerId: string) {
  const rpc = useRpc();
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setData((current) => (current ? { ...current, models: [], modelError: null } : current));
    rpc.call('catalog', { providerId })
      .then((next) => { if (live) { setData(next as Catalog); setError(''); } })
      .catch((err: unknown) => { if (live) { setData(null); setError(message(err)); } });
    return () => { live = false; };
  }, [rpc, providerId]);
  return { data, error };
}

/** Keep the current value selectable even when the host no longer lists it. */
function withCurrent(options: Array<{ id: string; name: string }>, current: string) {
  return current && !options.some((row) => row.id === current) ? [...options, { id: current, name: `${current} (unavailable)` }] : options;
}

type SettingsForm = { name: string; personality: string; projectId: string; providerId: string; model: string };

function settingsOf(bot: BotView): SettingsForm {
  return { name: bot.name, personality: bot.personality, projectId: bot.projectId, providerId: bot.providerId ?? '', model: bot.model ?? '' };
}

function Settings({ bot, onDeleted }: { bot: BotView; onDeleted(): void }) {
  const action = useAction(bot.id);
  const color = useAction(bot.id);
  const saved = settingsOf(bot);
  const [form, setForm] = useState<SettingsForm>(saved);
  const [dirty, setDirty] = useState<ReadonlySet<keyof SettingsForm>>(new Set());
  const catalog = useCatalog(form.providerId);
  const [editingModel, setEditingModel] = useState(false);

  // A change saved elsewhere (CLI, another agent, a realtime refresh) re-seeds every field the user has not touched.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    const next = JSON.parse(savedKey) as SettingsForm;
    setForm((current) => {
      const merged = { ...next };
      for (const key of dirty) merged[key] = current[key];
      return merged;
    });
  }, [savedKey]);

  const update = (patch: Partial<SettingsForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty((current) => new Set([...current, ...(Object.keys(patch) as Array<keyof SettingsForm>)]));
    action.clearError();
  };
  const set = (key: keyof SettingsForm) => (e: { target: { value: string } }) => update({ [key]: e.target.value });
  const changed = [...dirty].filter((key) => form[key] !== saved[key]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (changed.length === 0) return;
    const patch = Object.fromEntries(changed.map((key) => [key, form[key]]));
    const runtime = changed.some((key) => key === 'providerId' || key === 'model' || key === 'projectId');
    const done = runtime
      ? 'Saved. Personality applies from the next turn; provider, model and project apply when a new main thread is created.'
      : 'Saved. Applies from the next turn.';
    if (await action.run('update', { patch }, done)) setDirty(new Set());
  };

  const data = catalog.data;
  const providers = withCurrent(data?.providers ?? [], form.providerId);
  const models = withCurrent((data?.models ?? []).map((id) => ({ id, name: id })), form.model);
  const projects = withCurrent(data?.projects ?? [], form.projectId);
  return (
    <>
      <form className="settings-field" onSubmit={(event) => void save(event)} aria-label="Bot settings">
        <Section label="Identity">
          <div className="bt-row">
            <span className="bt-grow">Color{color.feedback}</span>
            <ColorPicker value={bot.color ?? defaultBotColor(bot.id)} disabled={color.busy}
              onChange={(next) => void color.run('update', { patch: { color: next } })} />
          </div>
          <div className="bt-row">
            <span className="bt-grow">Name</span>
            <input aria-label="Name" value={form.name} onChange={set('name')} />
          </div>
          <div className="bt-row" style={{ alignItems: 'flex-start' }}>
            <span className="bt-grow">Personality and role<span className="bt-sub">Applies from the next turn</span></span>
            <textarea aria-label="Personality and role" rows={4} value={form.personality} onChange={set('personality')} />
          </div>
        </Section>
        <Section label="Provider and model">
          {catalog.error && <p role="alert" className="bt-alert" style={{ padding: '8px 12px 0', margin: 0 }}>Couldn&apos;t load providers: {catalog.error}</p>}
          <div className="bt-row">
            <span className="bt-grow">Provider<span className="bt-sub">Applies when a new main thread starts</span></span>
            <PopoverPicklist ariaLabel="Provider" className="bt-picker" value={form.providerId}
              options={[{ value: '', label: 'Project default' }, ...providers.map(row => ({ value: row.id, label: row.name }))]}
              onChange={providerId => { setEditingModel(false); update({ providerId, model: '' }); }}
              searchPlaceholder="Search providers" />
          </div>
          <div className="bt-row">
            <span className="bt-grow">
              Model
              {data?.modelError && <span className="bt-sub">Models unavailable: {data.modelError}</span>}
            </span>
            <PopoverPicklist ariaLabel="Model" className="bt-picker" value={editingModel ? 'custom' : form.model ? 'model:' + form.model : ''}
              options={[{ value: '', label: 'Default' }, ...models.map(row => ({ value: 'model:' + row.id, label: row.name })),
                { value: 'custom', label: 'Custom model…' }]}
              onChange={choice => {
                setEditingModel(choice === 'custom');
                if (choice !== 'custom') update({ model: choice.slice('model:'.length) });
              }}
              searchPlaceholder="Search models" />
          </div>
          {editingModel && <div className="bt-row">
            <span className="bt-grow">Model ID</span>
            <input aria-label="Model ID" value={form.model} onChange={set('model')} autoFocus />
          </div>}
        </Section>
        <Section label="Project and access">
          <div className="bt-row">
            <span className="bt-grow">Project</span>
            <PopoverPicklist
              ariaLabel="Project"
              className="bt-picker"
              value={form.projectId}
              options={projects.map(project => ({ value: project.id, label: project.name }))}
              onChange={projectId => update({ projectId })}
              searchable
              searchPlaceholder="Search projects"
              emptyHint="No matching projects"
            />
          </div>
          <div className="bt-row"><span className="bt-grow">Access</span><span className="bt-chip is-warn">Full · runs without asking</span></div>
        </Section>
        {action.feedback}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <button type="submit" className="bt-btn is-primary" disabled={action.busy || changed.length === 0}>{action.busy ? 'Saving…' : 'Save'}</button>
          {changed.length === 0 && <span className="bt-note" style={{ margin: 0 }}>No changes</span>}
        </div>
      </form>
      <DeleteBot bot={bot} onDeleted={onDeleted} />
    </>
  );
}

function DeleteBot({ bot, onDeleted }: { bot: BotView; onDeleted(): void }) {
  const action = useAction(bot.id);
  const [confirming, setConfirming] = useState(false);
  const remove = async (archiveThreads: boolean) => {
    if (await action.run('remove', { archiveThreads })) onDeleted();
  };
  if (!confirming) {
    return (
      <Section label="Danger zone">
        <div className="bt-row">
          <span className="bt-grow">Delete {bot.name}<span className="bt-sub">Its routines stop immediately.</span></span>
          <button type="button" className="bt-btn is-danger" onClick={() => setConfirming(true)}>Delete bot…</button>
        </div>
      </Section>
    );
  }
  return (
    <Section label="Danger zone">
      <div role="group" aria-label="Confirm delete" className="bt-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <span>Delete {bot.name}? Its routines stop immediately.</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="bt-btn is-danger" disabled={action.busy} onClick={() => void remove(true)}>Delete and archive its threads</button>
          <button type="button" className="bt-btn is-danger" disabled={action.busy} onClick={() => void remove(false)}>Delete, keep threads</button>
          <button type="button" className="bt-btn is-ghost" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
        {action.feedback}
      </div>
    </Section>
  );
}

function useJobs(botId: string) {
  const rpc = useRpc();
  const [jobs, setJobs] = useState<BotJobView[] | null>(null);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const rows = (await rpc.call('jobs', { bot: botId })) as BotJobView[];
      if (mine !== seq.current) return;
      setJobs(rows);
      setError('');
    } catch (err) {
      if (mine === seq.current) setError(message(err));
    }
  }, [rpc, botId]);
  useEffect(() => { void load(); return () => { seq.current++; }; }, [load]);
  useRealtime(CHANNEL, (payload) => {
    const id = (payload as { botId?: unknown } | null)?.botId;
    if (!id || id === botId) void load();
  });
  return { jobs, error };
}

function Library({ bot, visible, jobsState }: { bot: BotView; visible: boolean; jobsState: ReturnType<typeof useJobs> }) {
  const openChat = useOpenChat();
  const { jobs, error } = jobsState;
  const tag = botMemoryTag(bot);
  return (
    <>
      <Section label="Background jobs">
        {error && <p role="alert" className="bt-alert" style={{ padding: '8px 12px', margin: 0 }}>{error}</p>}
        {jobs === null && !error && <p role="status" className="bt-note" style={{ padding: '10px 12px', margin: 0 }}>Loading jobs…</p>}
        {jobs?.length === 0 && <p role="status" className="bt-note" style={{ padding: '10px 12px', margin: 0 }}>No background jobs yet.</p>}
        {jobs?.map((job) => (
          <button key={job.threadId} type="button" className="bt-row" onClick={() => openChat({ name: job.title }, job.threadId)}>
            <span className="bt-ico" aria-hidden="true">{ACTIVE_JOB.has(job.status) ? '…' : '✓'}</span>
            <span className="bt-grow">
              {job.title}
              <span className="bt-sub">{job.archived ? 'archived' : job.status} · {new Date(job.startedAt).toLocaleString()}</span>
            </span>
            <span style={muted} aria-hidden="true">›</span>
          </button>
        ))}
      </Section>
      <Section label="Memory">
        {visible && <BotMemory key={bot.projectId} tag={tag} projectId={bot.projectId} />}
      </Section>
    </>
  );
}

const ACTIVE_JOB = new Set(['active', 'starting', 'stopping']);

export default definePluginApp((app) => {
  app.slots.navPanel({ id: 'bots', title: 'Bots', icon: 'Bot', component: BotsPanel });
});
