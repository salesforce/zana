import { PopoverPicklist } from '@zana-ai/zcc-ui/popover-picklist';
import { ChevronDown, Pin, Plus } from 'lucide-react';
import { VaultPanel } from './src/vault/VaultPanel.js';
import { Section, botSectionCss } from './src/BotSection.js';
import { BotMemory } from './src/BotMemory.js';
import { HelperLibrary } from './src/helper/HelperLibrary.js';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { definePluginApp, Markdown, useRealtime, useRpc, useZccNavigate, type BasicSidebarSectionProps, type PluginOwnedThreadIconProps, type PluginOwnedThreadTitleProps, type PluginThreadPanelProps } from '@zana-ai/zcc-plugin-sdk/app';
import { BOT_COLORS, DIRECT_INTERVAL_MINUTES, MIN_ROUTINE_INTERVAL_MINUTES, ROUTINE_KINDS, type RoutineKind, botMemoryTag, defaultBotColor, defaultBotShape, describeCron, type BotRoutine, type BotShape } from './src/model.js';
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
.bt-root :where(button){font:inherit;color:inherit}
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
.bt-main{min-height:0;flex:1;min-width:0;overflow:auto;scrollbar-gutter:stable both-edges}
.bt-page{container:bot-page / inline-size;box-sizing:content-box;max-width:880px;margin-inline:auto;padding:0 clamp(12px,3%,32px) 48px}
.bt-page>.bt-hero{padding-top:22px}
.bt-hero{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.bt-hero-text{flex:1;min-width:180px}
.bt-hero h2{margin:0;font-size:23px;letter-spacing:-.035em;font-weight:600}
.bt-hero-text > p{margin:2px 0 0;color:var(--text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bt-actions{display:flex;gap:6px}
.bt-chips{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
.bt-chip{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--bg-elevated);color:var(--text-muted);border:1px solid var(--border)}
.bt-chip.is-warn{color:var(--warning,var(--text-muted));background:transparent;border:0;padding:0}
.bt-tabs{display:flex;gap:16px;margin-top:18px;border-bottom:1px solid var(--border)}
.bt-tabs button{border:0;background:transparent;padding:8px 0;cursor:pointer;color:var(--text-muted);border-bottom:2px solid transparent;margin-bottom:-1px}
.bt-tabs button[aria-selected="true"]{color:var(--text-primary);border-bottom-color:var(--accent-blue);font-weight:500}
.bt-grow{flex:1;min-width:0}
.bt-routine-actions{display:flex;align-items:center;gap:12px;max-width:100%}
.bt-rowacts{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-width:0}
.bt-row.is-routine{flex-wrap:wrap}
.bt-when{text-align:right;font-size:12px;color:var(--text-muted)}
.bt-row.is-routine .bt-grow{flex:1 1 130px}
.bt-sw{width:30px;height:18px;border-radius:999px;border:0;background:var(--border-strong,#4a4c57);position:relative;cursor:pointer;flex:none;padding:0}
.bt-sw::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.bt-sw[aria-checked="true"]{background:var(--accent-blue)}
.bt-sw[aria-checked="true"]::after{left:14px}
.bt-sw:disabled{cursor:progress;opacity:.7}
.bt-personality-field.bt-field{display:grid;gap:8px;grid-template-columns:minmax(0,1fr)}
.bt-field{display:block;margin-top:10px;color:var(--text-muted);font-size:12px}
.bt-field > :is(input,textarea,select){display:block;width:100%;margin-top:4px;font-size:13px}
.bt-colors{display:flex;gap:6px}
.bt-colors button{width:16px;height:16px;border-radius:50%;border:0;cursor:pointer;padding:0}
.bt-colors button[aria-checked="true"]{box-shadow:0 0 0 2px var(--bg-panel),0 0 0 3.5px var(--text-primary)}
.bt-colors.is-lg button{width:20px;height:20px}
.bt-note{font-size:12px;color:var(--text-muted);margin:6px 0 0}
.bt-alert{font-size:12px;color:var(--danger,#f85149);margin:6px 0 0}
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
.bt-topline,.bt-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bt-topline{border-bottom:1px solid var(--border);padding-block:9px;color:var(--text-muted);font-size:12px;overflow-wrap:anywhere}
.bt-meta{font-size:12px;color:var(--text-muted)}
.bt-settings-panel fieldset{border:0;min-width:0;padding:0;margin:0}
.bt-savebar{position:sticky;bottom:0;z-index:2;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;
  margin-top:16px;padding:10px 12px;border:1px solid var(--border);border-radius:9px;background:var(--bg-panel);box-shadow:0 2px 12px rgb(0 0 0 / .12)}
.bt-savebar .bt-note,.bt-savebar .bt-alert{margin:0}
.bt-savebar-message{flex:1 1 120px;min-width:0;font-size:12px;color:var(--text-muted)}
.bt-savebar-actions{display:flex;gap:6px}
.bt-root .bt-field :is(input,select,textarea){box-sizing:border-box}
.bt-memory summary{display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer}
.bt-memory summary::-webkit-details-marker{display:none}
.bt-memory summary::after{content:"";width:6px;height:6px;flex:none;border-right:1.5px solid var(--text-muted);border-bottom:1.5px solid var(--text-muted);transform:rotate(-45deg);margin-right:3px}
.bt-memory[open]>summary::after{transform:rotate(45deg)}
.bt-memory p{white-space:pre-wrap;overflow-wrap:anywhere}
.bt-grow,.bt-hero-text,.bt-memory{overflow-wrap:anywhere}
.bt-root .settings-field{margin-bottom:0}
@container (max-width:700px){.bt-layout{grid-template-columns:135px minmax(0,1fr)}.bt-list-head{flex-wrap:wrap}.bt-when{text-align:left}.bt-row.is-routine .bt-grow{flex-basis:55%}}
@container (max-width:520px){.bt-layout{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.bt-root .bt-list{max-height:110px;flex-direction:row;align-items:center;overflow:auto;border-right:0;border-bottom:1px solid var(--border)}.bt-list .bt-item{width:auto;flex:none}.bt-list-head{flex:none;gap:4px}.bt-page{padding-bottom:32px}.bt-page>.bt-hero{padding-top:16px}.bt-row{flex-wrap:wrap}.bt-colors{flex-wrap:wrap}}
.bt-root code{font-size:12px}
@container bot-page (max-width:540px){
  .bt-row.is-routine{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
  .bt-routine-actions{justify-content:space-between}
}
${botSectionCss}
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
type BotIdentity = Pick<BotView, 'id' | 'name' | 'color'>;

export function BotAvatar({ bot, size = 40, live = false }: { bot: BotIdentity | BotView; size?: number; live?: boolean }) {
  const state = 'mainThreadStatus' in bot ? botState(bot) : undefined;
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

function BotListIdentity({ bot, live, statusId, children }: { bot: BotView; live: boolean; statusId?: string; children?: ReactNode }) {
  const state = botState(bot);
  return <>
    <BotAvatar bot={bot} size={30} live={live} />
    <span style={{ minWidth: 0 }}>
      <span className="bt-name">{bot.name}</span>
      <small id={statusId}><span className="bt-dot" data-state={state} />{STATE_LABEL[state]}{children}</small>
    </span>
  </>;
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
  const feedback = (error || notice) ? (
    <>
      {error && <span role="alert" className="bt-alert" style={{ display: 'block' }}>{error}</span>}
      {notice && <span role="status" className="bt-note" style={{ display: 'block' }}>{notice}</span>}
    </>
  ) : null;
  return { run, busy, feedback, clearFeedback: () => { setError(''); setNotice(''); } };
}

function useBotList() {
  const rpc = useRpc();
  const [bots, setBots] = useState<BotView[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const rows = (await rpc.call('list')) as BotView[];
      if (mine !== seq.current) return;
      setBots(rows);
      setError('');
    } catch (err) {
      if (mine === seq.current) setError(message(err));
    } finally {
      if (mine === seq.current) setLoaded(true);
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
    return () => { seq.current++; };
  }, [refresh]);
  useRealtime(CHANNEL, () => void refresh());

  return { bots, loaded, error, refresh };
}

const BASIC_BOT_LIMIT = 5;

const basicListCss = `
.bt-basic { margin-bottom: 18px; font-size: 13px; line-height: 1.5; color: var(--text-primary); }
.bt-basic .bt-list-head h2 { margin: 0; font-size: 13px; font-weight: 600; color: inherit; }
.bt-basic .bt-list-head button { color: inherit; font-family: inherit; }
.bt-basic-list { display: grid; gap: 2px; }
.bt-basic-item { position: relative; display: flex; align-items: center; border-radius: 8px; }
.bt-basic-item:is(:hover, :focus-within) { background: var(--bg-hover); }
.bt-basic-item:has([aria-current="page"]) { background: var(--bg-elevated); }
.bt-basic-pin { display: grid; place-items: center; flex: 0 0 30px; height: 30px; border-radius: 6px;
  padding: 0; margin-right: 4px; background: transparent; border: 0; color: var(--text-muted); cursor: pointer; }
.bt-basic-pin:hover, .bt-basic-pin:focus-visible { color: var(--text-primary); background: var(--bg-hover); }
.bt-basic-pin svg { transform: rotate(35deg); }
.bt-basic-pin[aria-pressed="true"] svg { fill: currentColor; }
@media (hover: hover) and (pointer: fine) {
  .bt-basic-item:not(:hover):not(:focus-within) .bt-basic-pin[aria-pressed="false"] { position: absolute; right: 0; opacity: 0; }
}
.bt-basic-more { display: block; padding: 8px 10px 8px 48px; border: 0; background: transparent;
  color: var(--text-muted); font: inherit; font-size: 12px; cursor: pointer; }
.bt-basic-more:hover, .bt-basic-more:focus-visible { color: var(--text-primary); }
.bt-basic .bt-basic-row { flex: 1; min-width: 0; font: inherit; color: inherit; background: transparent; }
.bt-basic-dialog { box-sizing: border-box; width: min(500px, calc(100vw - 32px)); max-height: calc(100dvh - 32px);
  padding: 0; margin: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-panel); }
.bt-basic-dialog::backdrop { background: rgb(0 0 0 / 45%); }
.bt-basic-dialog .bt-root { height: auto; }
.bt-basic-dialog .bt-create { min-width: 0; }
.bt-basic .bt-note, .bt-basic [role="alert"] { color: var(--text-muted); font-size: 11px; }
`;

function BasicBotRow({ bot, activeThreadId, opening, onOpen }: {
  bot: BotView; activeThreadId: string | null; opening: boolean; onOpen(): void;
}) {
  const current = Boolean(activeThreadId && bot.mainThreadId === activeThreadId);
  const statusId = useId();
  const pinned = bot.pinnedAt != null;
  const { busy, feedback, run } = useAction(bot.id);
  return <>
    <div className="bt-basic-item">
      <button type="button" className="bt-item bt-basic-row" title={bot.name} aria-label={bot.name} aria-describedby={statusId}
        aria-current={current ? 'page' : undefined}
        aria-busy={opening} disabled={opening} onClick={onOpen}>
        <BotListIdentity bot={bot} live={current} statusId={statusId} />
      </button>
      <button type="button" className="bt-basic-pin" aria-label={`${pinned ? 'Unpin' : 'Pin'} ${bot.name}`}
        title={pinned ? 'Unpin bot' : 'Pin bot'} aria-pressed={pinned} disabled={busy}
        onClick={() => void run('update', { patch: { pinned: !pinned } })}>
        <Pin size={15} aria-hidden="true" />
      </button>
    </div>
    {feedback}
  </>;
}

export function BasicBots({ searchQuery, activeThreadId, projectIds, openThread, registerThreads }: BasicSidebarSectionProps) {
  const { bots, loaded, error, refresh } = useBotList();
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const rpc = useRpc();
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState('');
  const attempt = useRef(0);
  useEffect(() => {
    setOpening(null);
    setOpenError('');
    return () => { attempt.current++; };
  }, [activeThreadId]);
  async function openBot(botId: string) {
    const current = ++attempt.current;
    setOpening(botId);
    setOpenError('');
    try {
      const { threadId } = await rpc.call('openThread', { bot: botId }) as { threadId: string };
      if (current === attempt.current) openThread(threadId);
    } catch (err) {
      if (current === attempt.current) setOpenError(message(err));
    } finally {
      if (current === attempt.current) setOpening(null);
    }
  }
  const eligible = useMemo(() => bots.filter(bot => projectIds.includes(bot.projectId)), [bots, projectIds]);
  useEffect(() => {
    const ids = eligible.flatMap(bot => bot.mainThreadId ? [bot.mainThreadId] : []);
    if (ids.length) return registerThreads(ids);
  }, [eligible, registerThreads]);
  const query = searchQuery.trim().toLocaleLowerCase();
  const matches = eligible.filter(bot => bot.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => (b.pinnedAt ?? -1) - (a.pinnedAt ?? -1));
  // Search the whole roster, including the bots behind Show more.
  const visible = showAll || query ? matches : matches.slice(0, BASIC_BOT_LIMIT);
  if (!matches.length && !error && (!loaded || query || !projectIds.length)) return null;
  return <section className="bt-basic" aria-label="Bots">
    <style>{CSS + basicListCss}</style>
    <div className="bt-list-head">
      <h2>Bots</h2>
      <button type="button" className="bt-btn is-ghost is-sm" aria-haspopup="dialog" onClick={() => setCreating(true)}>＋ New bot</button>
    </div>
    {creating && <CreateBotDialog projectId={projectIds.length === 1 ? projectIds[0] : undefined}
      onCancel={() => setCreating(false)} onCreated={id => {
        setCreating(false);
        setShowAll(true);
        void openBot(id);
        void refresh();
      }} />}
    {error && <p role="alert">Couldn’t load bots. <button type="button" onClick={() => void refresh()}>Retry</button></p>}
    {openError && <p role="alert" className="bt-alert">{openError}</p>}
    <div id={listId} className="bt-basic-list">
      {visible.map(bot => <BasicBotRow key={bot.id} bot={bot} activeThreadId={activeThreadId} opening={opening === bot.id}
        onOpen={() => void openBot(bot.id)} />)}
    </div>
    {!query && matches.length > BASIC_BOT_LIMIT && <button type="button" className="bt-basic-more"
      aria-expanded={showAll} aria-controls={listId} onClick={() => setShowAll(!showAll)}>
      {showAll ? 'Show less' : 'Show more'}
    </button>}
  </section>;
}

export function BotsPanel() {
  const { bots, loaded, error, refresh } = useBotList();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const bot = bots.find((row) => row.id === selected) ?? bots[0] ?? null;
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
            const active = row.id === bot?.id && !showCreate;
            const routines = row.routines.filter((r) => r.enabled).length;
            return (
              <button key={row.id} type="button" className="bt-item" aria-current={active ? 'true' : undefined}
                onClick={() => { setSelected(row.id); setCreating(false); }}>
                <BotListIdentity bot={row} live={active}>
                  {routines ? ` · ${routines} routine${routines === 1 ? '' : 's'}` : ''}
                  {row.activeJobs ? ` · ${row.activeJobs} job${row.activeJobs === 1 ? '' : 's'}` : ''}
                </BotListIdentity>
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

interface CreateBotProps { projectId?: string; onCancel(): void; onCreated(id: string): void }

function CreateBotDialog(props: CreateBotProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return <dialog ref={ref} className="bt-basic-dialog" aria-label="New bot"
    onCancel={event => { event.preventDefault(); props.onCancel(); }}>
    <div className="bt-root"><CreateBot {...props} canCancel /></div>
  </dialog>;
}

function PersonalityEditor({ value, onChange, disabled }: {
  value: string; onChange(value: string): void; disabled: boolean;
}) {
  return <Markdown content={value} editor={{ label: 'Personality and role', onChange, disabled,
    placeholder: 'Describe this bot’s role and how it should work.' }} />;
}

function CreateBot(props: CreateBotProps & { canCancel: boolean }) {
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
      const bot = (await rpc.call('create', { name, color, personality, ...(props.projectId && { projectId: props.projectId }) })) as { id: string };
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
          <p>One persistent thread with a personality. Anyone can message it, routines post updates on a schedule, and it runs heavy work in hidden background jobs.</p>
        </div>
      </div>
      <div className="bt-chips"><span className="bt-chip is-warn" title="Bots run without asking for approval">Full access</span></div>
      <label className="bt-field settings-field">Name<input value={name} onChange={edit(setName)} placeholder="Release Scout" /></label>
      <div className="bt-field settings-field">Color<div style={{ marginTop: 6 }}><ColorPicker value={color} onChange={setColor} large /></div></div>
      <div className="bt-field bt-personality-field">
        <span>Personality and role</span>
        <PersonalityEditor value={personality} disabled={busy} onChange={value => { setPersonality(value); setError(''); }} />
      </div>
      {error && <p role="alert" className="bt-alert">{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button type="submit" className="bt-btn is-primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create bot'}</button>
        {props.canCancel && <button type="button" className="bt-btn" onClick={props.onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function ColorPicker({ value, disabled, large, savedColor, onChange }: {
  value: string; disabled?: boolean; large?: boolean; savedColor?: string; onChange(color: string): void;
}) {
  const colors: readonly string[] = savedColor && !BOT_COLORS.some(color => color === savedColor)
    ? [...BOT_COLORS, savedColor] : BOT_COLORS;
  const current = colors.indexOf(value);
  return (
    <div role="radiogroup" aria-label="Color" className={large ? 'bt-colors is-lg' : 'bt-colors'}>
      {colors.map((color, index) => {
        const checked = color === value;
        return (
          <button key={color} type="button" role="radio" aria-checked={checked} aria-label={COLOR_NAMES[index] ?? `Saved color ${color}`} disabled={disabled}
            tabIndex={checked || (current < 0 && index === 0) ? 0 : -1}
            onClick={() => onChange(color)}
            onKeyDown={(event) => arrowNav(event, colors.length, index, (next) => onChange(colors[next]!))}
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

const TABS = [['details', 'Overview'], ['library', 'Library'], ['vault', 'Vault'], ['settings', 'Settings']] as const;
type Tab = (typeof TABS)[number][0];
const WAKE_MESSAGE = 'Check in: anything new since your last run? Reply in a few lines.';

type ThreadBotResult<T> = { bot: T | null | undefined; error: string; refresh(): Promise<void> };

function useThreadBot(threadId: string, profile: true, active: boolean): ThreadBotResult<BotView>;
function useThreadBot(threadId: string, profile: false): ThreadBotResult<BotIdentity>;
function useThreadBot(threadId: string, profile: boolean, active = true): ThreadBotResult<BotIdentity | BotView> {
  const rpc = useRpc();
  const [bot, setBot] = useState<BotIdentity | BotView | null>();
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (!active) return;
    const request = ++sequence.current;
    try {
      const result = await rpc.call('threadBot', { threadId, profile }) as BotIdentity | BotView | null;
      if (request !== sequence.current) return;
      setBot(result);
      setError('');
    } catch (err) {
      if (request === sequence.current) setError(message(err));
    }
  }, [active, rpc, threadId, profile]);
  useEffect(() => {
    void refresh();
    return () => { sequence.current++; };
  }, [refresh]);
  useRealtime(CHANNEL, payload => {
    const id = (payload as { botId?: string } | null)?.botId;
    if (!id || !bot || id === bot.id) void refresh();
  });
  return { bot, error, refresh };
}

const profileCss = `
.bt-thread-title{display:inline-flex;align-items:center;vertical-align:middle;gap:7px;max-width:100%;min-width:0;
  padding:3px 9px 3px 5px;border:1px solid var(--border);border-radius:999px;background:var(--bg-panel);
  color:var(--text-primary);font:inherit;cursor:pointer;-webkit-app-region:no-drag}
.bt-thread-title:hover{background:var(--bg-hover);border-color:var(--text-dim)}
.bt-thread-title:focus-visible{outline:2px solid var(--accent-blue);outline-offset:-2px}
.bt-thread-title>span:not(.bt-av){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-thread-title>svg{flex:none;color:var(--text-muted)}
.bt-profile .bt-page{padding-bottom:36px}
.bt-profile .bt-hero-text{min-width:0}
.bt-profile .bt-personality{overflow-wrap:anywhere}
.bt-profile .bt-personality :is(ul,ol,blockquote,pre){text-align:start}
`;

export function BotThreadIcon({ threadId, size, fallback }: PluginOwnedThreadIconProps) {
  const { bot, error } = useThreadBot(threadId, false);
  if (bot === undefined && !error) return null;
  return bot ? <BotAvatar bot={bot} size={size} /> : <>{fallback}</>;
}

export function BotThreadTitle({ threadId, title, openPanel }: PluginOwnedThreadTitleProps) {
  const { bot, error } = useThreadBot(threadId, false);
  if (bot === undefined && !error) return null;
  if (!bot) return <>{title}</>;
  return <><style>{profileCss}</style>
    <button type="button" className="bt-thread-title" aria-label={`Open ${bot.name} profile`}
      title={`Open ${bot.name} profile`} onPointerDown={event => event.stopPropagation()} onClick={openPanel}>
      <BotAvatar bot={bot} size={22} /><span>{bot.name}</span><ChevronDown size={13} aria-hidden="true" />
    </button></>;
}

export function BotThreadProfile({ threadId, active }: PluginThreadPanelProps) {
  return <ThreadProfile key={threadId} threadId={threadId} active={active} />;
}

function ThreadProfile({ threadId, active = true }: { threadId: string; active?: boolean }) {
  const { bot, error, refresh } = useThreadBot(threadId, true, active);
  return <div className="bt-root bt-profile"><style>{CSS + profileCss}</style><div className="bt-main">
    {error && <p role="alert" className="bt-empty-line">Couldn’t load the bot profile. <button type="button" className="bt-btn" onClick={() => void refresh()}>Retry</button></p>}
    {bot ? <BotPage key={bot.id} bot={bot} profile active={active} onDeleted={() => void refresh()} />
      : !error && <p role="status" className="bt-empty-line">{bot === undefined ? 'Loading profile…' : 'This conversation no longer belongs to a bot.'}</p>}
  </div></div>;
}

function BotPage({ bot, onDeleted, profile = false, active = true }: {
  bot: BotView; onDeleted(): void; profile?: boolean; active?: boolean;
}) {
  const tabsId = useId();
  const [tab, setTab] = useState<Tab>('details');
  const openChat = useOpenChat();
  const rpc = useRpc();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const wake = useAction(bot.id);
  const catalog = useCatalog(bot.providerId ?? '');
  const jobs = useJobs(bot.id, active);
  const state = botState(bot);
  const hasThread = Boolean(bot.mainThreadId) && (state === 'working' || state === 'asleep');
  const projectName = catalog.data?.projects.find((row) => row.id === bot.projectId)?.name ?? (catalog.data || catalog.error ? bot.projectId : '…');

  async function chat() {
    if (hasThread) {
      openChat(bot, bot.mainThreadId!);
      return;
    }
    setOpening(true);
    setOpenError('');
    try {
      const { threadId } = await rpc.call('openThread', { bot: bot.id }) as { threadId: string };
      openChat(bot, threadId);
    } catch (error) {
      setOpenError(message(error));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="bt-page">
      {!profile && <div className="bt-topline">Bots <span aria-hidden="true">/</span> {bot.name}</div>}
      <header className="bt-hero">
        <BotAvatar bot={bot} size={44} live={active} />
        <div className="bt-hero-text">
          <div className="bt-title"><h2>{bot.name}</h2>
            <span className="bt-chip"><span className="bt-dot" data-state={state} />{STATE_LABEL[state]}
              {bot.activeJobs ? ` · ${bot.activeJobs} background job${bot.activeJobs === 1 ? '' : 's'}` : ''}</span>
          </div>
          <span className="bt-meta">{projectName} · <span className="bt-chip is-warn" title="Bots run without asking for approval">Full access</span></span>
        </div>
        {!profile && <div className="bt-actions">
          <button type="button" className="bt-btn is-primary" disabled={opening || state === 'unknown'}
            onClick={() => void chat()}>{opening ? 'Opening…' : 'Chat'}</button>
          {state === 'asleep' && (
            <button type="button" className="bt-btn" disabled={wake.busy}
              onClick={() => void wake.run('send', { message: WAKE_MESSAGE }, `${bot.name} is waking up`)}>Wake</button>
          )}
        </div>}
      </header>
      {wake.feedback}
      {openError && <p role="alert" className="bt-alert">{openError}</p>}
      <div role="tablist" aria-label={`${bot.name} sections`} className="bt-tabs">
        {TABS.map(([id, label], index) => (
          <button key={id} id={`${tabsId}-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`${tabsId}-panel-${id}`}
            tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}
            onKeyDown={(event) => arrowNav(event, TABS.length, index, (next) => setTab(TABS[next]![0]))}>
            {label}
          </button>
        ))}
      </div>
      {/* Every panel stays mounted so unsaved edits and scroll survive a tab switch. */}
      <div role="tabpanel" id={`${tabsId}-panel-details`} aria-labelledby={`${tabsId}-tab-details`} hidden={tab !== 'details'}>
        {!profile && !hasThread && <StartConversation bot={bot} state={state} onStarted={(threadId) => openChat(bot, threadId)} />}
        <Details bot={bot} jobs={jobs} openLibrary={() => setTab('library')} visible={active && tab === 'details'} />
        {profile && bot.personality && <Section label="Personality and role"><Markdown className="bt-inset bt-personality" content={bot.personality} /></Section>}
      </div>
      <div role="tabpanel" id={`${tabsId}-panel-library`} aria-labelledby={`${tabsId}-tab-library`} hidden={tab !== 'library'}>
        <Library bot={bot} jobsState={jobs} visible={active && tab === 'library'} />
      </div>
      <div role="tabpanel" id={`${tabsId}-panel-vault`} aria-labelledby={`${tabsId}-tab-vault`} hidden={tab !== 'vault'}>
        {active && tab === 'vault' && <VaultPanel bot={bot} />}
      </div>
      <div role="tabpanel" id={`${tabsId}-panel-settings`} aria-labelledby={`${tabsId}-tab-settings`} className="bt-settings-panel" hidden={tab !== 'settings'}>
        <Settings bot={bot} onDeleted={onDeleted} visible={active && tab === 'settings'} />
      </div>
    </div>
  );
}

function StartConversation({ bot, state, onStarted }: { bot: BotView; state: BotState; onStarted(threadId: string): void }) {
  const rpc = useRpc();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (state === 'unknown') {
    return <Section label="Conversation"><p role="status" className="bt-empty-line">Can&apos;t reach {bot.name}&apos;s thread right now. It will reappear when the host responds.</p></Section>;
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
    <Section label="Conversation">
      <form className="bt-form settings-field" aria-label={`Start ${bot.name}`} onSubmit={(event) => void start(event)}>
        <p className="bt-empty-line">{state === 'missing'
          ? `${bot.name}'s main thread was deleted. Your next message starts a fresh main thread; routines and memory are kept.`
          : `${bot.name} has no thread yet. The first message wakes it up and opens the chat beside this page.`}</p>
        <label className="bt-form-row">Message
          <textarea aria-label={`Message ${bot.name}`} value={text} rows={3}
            onChange={(e) => { setText(e.target.value); setError(''); }} placeholder="Introduce yourself and tell me what you can do." />
        </label>
        {error && <p role="alert" className="bt-empty-line bt-alert">{error}</p>}
        <div className="bt-form-footer"><button type="submit" className="bt-btn is-primary" disabled={busy || !text.trim()}>{busy ? 'Starting…' : 'Start conversation'}</button></div>
      </form>
    </Section>
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
    ...bot.routines.filter(r => r.lastRunAt).map(r => ({ key: 'routine-' + r.id, name: r.name, at: r.lastRunAt!, detail: routineActivity(r.runs?.[0]?.status), threadId: bot.mainThreadId, title: bot.name })),
    ...(jobs.jobs ?? []).map(j => ({ key: 'job-' + j.threadId, name: j.title, at: j.startedAt, detail: j.archived ? 'Archived job' : 'Job · ' + j.status, threadId: j.threadId, title: j.title }))
  ].sort((a, b) => b.at - a.at).slice(0, 5);
  return <>
    <Section label="Routines" action={!adding && <button className="bt-btn is-sm" onClick={() => setAdding(true)}><Plus size={14} aria-hidden="true" />Add routine</button>}>
      {bot.routines.map(routine => <RoutineRow key={routine.id} bot={bot} routine={routine} nextRun={nextRuns[routine.id]} />)}
      {!adding && !bot.routines.length && <p className="bt-empty-line">No routines scheduled.</p>}
      {adding && <RoutineForm bot={bot} onDone={() => setAdding(false)} />}
    </Section>
    <Section label="Recent activity" action={<button className="bt-btn is-ghost is-sm" onClick={openLibrary}>Open library →</button>}>
      {jobs.error && <p className="bt-empty-line">Couldn’t load job activity. {jobs.error}</p>}
      {!activity.length && !jobs.error && <p className="bt-empty-line">{jobs.jobs ? 'No recent activity.' : 'Loading activity…'}</p>}
      {visible && activity.map(row => <button className="bt-row" key={row.key} disabled={!row.threadId}
        onClick={() => row.threadId && openChat({ name: row.title }, row.threadId)}>
        <span className="bt-grow"><span className="bt-row-title">{row.name}</span><span className="bt-sub">{row.detail}</span></span>
        <time className="bt-sub" dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleString()}</time>
      </button>)}
    </Section>
  </>;
}

const RUN_STATUS_LABELS = {
  posted: 'Posted to main chat',
  quiet: 'Nothing new · not posted',
  running: 'Running',
  sent: 'AI prompt delivered',
  failed: 'Failed'
} as const;

function routineActivity(status: keyof typeof RUN_STATUS_LABELS | undefined): string {
  if (status === 'failed') return 'Routine failed';
  if (status === 'posted' || status === 'quiet' || status === 'running') return RUN_STATUS_LABELS[status];
  return 'Routine ran';
}

function RoutineRow({ bot, routine, nextRun }: { bot: BotView; routine: BotRoutine; nextRun?: number | null }) {
  const action = useAction(bot.id);
  const [enabled, setEnabled] = useState(routine.enabled);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setEnabled(routine.enabled), [routine.enabled]);
  const labelId = `routine-${bot.id}-${routine.id}`;
  const toggle = async (next: boolean) => {
    setEnabled(next);
    if (!(await action.run('updateRoutine', { routineId: routine.id, patch: { enabled: next } }))) setEnabled(!next);
  };
  if (editing) return <RoutineForm bot={bot} routine={routine} onDone={() => { setEditing(false); setConfirming(false); }} />;
  return (
    <div role="group" aria-labelledby={labelId} className="bt-row is-routine">
      <span className="bt-grow">
        <span className="bt-row-title" id={labelId}>{routine.name}</span>
        <span className="bt-sub">{ROUTINE_KINDS[routine.kind ?? 'agent']} · {routine.kind && routine.kind !== 'agent' ? 'No AI' : 'Uses AI each run'}</span>
        <span className="bt-sub">
          {describeCron(routine.cron)} · {routine.lastRunAt ? `last ${new Date(routine.lastRunAt).toLocaleString()}` : 'never run'}
        </span>
        {!!routine.runs?.length && <details className="bt-sub"><summary>Recent runs</summary>
          {routine.runs.map((run, index) => <div key={index}><time>{new Date(run.at).toLocaleString()}</time> · {
            run.status === 'failed' ? `Failed · ${run.error}` : RUN_STATUS_LABELS[run.status]
          }</div>)}
        </details>}
        {action.feedback}
      </span>
      {enabled && nextRun && <span className="bt-when">Next run<span className="bt-sub">{new Date(nextRun).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></span>}
      <div className="bt-routine-actions">
        <span className="bt-rowacts">
          {confirming ? (
            <>
              <button type="button" className="bt-btn is-sm" disabled={action.busy} onClick={() => setEditing(true)}>Edit routine</button>
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
    </div>
  );
}

type Frequency = 'ten' | 'weekdays' | 'daily' | 'weekly' | 'hourly' | 'custom';
const FREQUENCIES: Array<[Frequency, string]> = [['ten', 'Every 10 minutes'], ['weekdays', 'Weekdays'], ['daily', 'Every day'], ['weekly', 'Weekly'], ['hourly', 'Hourly'], ['custom', 'Custom cron']];

export function cronFor(freq: Frequency, time: string, day: string, custom: string, minuteOfHour = '0'): string {
  const [hour, minute] = /^\d{1,2}:\d{2}$/.test(time) ? time.split(':').map(Number) as [number, number] : [9, 0];
  if (freq === 'ten') return '*/10 * * * *';
  if (freq === 'weekdays') return `${minute} ${hour} * * 1-5`;
  if (freq === 'daily') return `${minute} ${hour} * * *`;
  if (freq === 'weekly') return `${minute} ${hour} * * ${day}`;
  if (freq === 'hourly') {
    const at = Number(minuteOfHour);
    return `${Number.isInteger(at) && at >= 0 && at <= 59 ? at : 0} * * * *`;
  }
  return custom.trim();
}

function RoutineForm({ bot, routine, onDone }: { bot: BotView; routine?: BotRoutine; onDone(): void }) {
  const action = useAction(bot.id);
  const [name, setName] = useState(routine?.name ?? '');
  const [kind, setKind] = useState<RoutineKind>(routine?.kind ?? 'agent');
  const [asset, setAsset] = useState(routine?.asset ?? 'BTC');
  const [currencies, setCurrencies] = useState(routine?.currencies?.join(', ') ?? 'USD, CHF');
  const [prompt, setPrompt] = useState(routine?.prompt ?? '');
  const [freq, setFreq] = useState<Frequency>(routine ? 'custom' : 'weekdays');
  const [time, setTime] = useState('08:00');
  const [minute, setMinute] = useState('0');
  const [day, setDay] = useState('1');
  const [custom, setCustom] = useState(routine?.cron ?? '0 9 * * 1-5');
  const cron = cronFor(freq, time, day, custom, minute);
  const edit = (setter: (value: string) => void) => (e: { target: { value: string } }) => { setter(e.target.value); action.clearFeedback(); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const fields = kind === 'price' ? { kind, name, cron, asset, currencies: currencies.split(',').map(s => s.trim()) }
      : { name, cron, prompt, ...(routine || kind !== 'agent' ? { kind } : {}) };
    const saved = routine ? await action.run('updateRoutine', { routineId: routine.id, patch: fields })
      : await action.run('addRoutine', { routine: fields });
    if (saved) onDone();
  };

  return (
    <form aria-label={routine ? "Edit routine" : "Add routine"} onSubmit={(event) => void submit(event)} className="bt-form settings-field">
      <label className="bt-form-row">Name<input value={name} onChange={edit(setName)} placeholder="Morning digest" /></label>
      <div className="bt-form-row">Action
        <PopoverPicklist ariaLabel="Action" className="bt-picker" value={kind}
          options={(Object.keys(ROUTINE_KINDS) as RoutineKind[]).map(value => ({ value, label: ROUTINE_KINDS[value] }))}
          onChange={next => {
            setKind(next);
            if (next === 'agent' && freq === 'ten') { setFreq('custom'); setCustom(cron); }
            action.clearFeedback();
          }} searchPlaceholder="Search actions" />
      </div>
      <div className="bt-form-row">When
        <PopoverPicklist ariaLabel="When" className="bt-picker" value={freq}
          options={FREQUENCIES.filter(([value]) => value !== 'ten' || kind !== 'agent').map(([value, label]) => ({ value, label }))}
          onChange={setFreq} searchPlaceholder="Search frequencies" />
      </div>
      {freq === 'hourly' && (
        <label className="bt-form-row">Minute past the hour<input type="number" min={0} max={59} value={minute} onChange={edit(setMinute)} /></label>
      )}
      {freq !== 'ten' && freq !== 'custom' && freq !== 'hourly' && (
        <label className="bt-form-row">Around<input type="time" value={time} onChange={edit(setTime)} /></label>
      )}
      {freq === 'weekly' && (
        <div className="bt-form-row">Day
          <PopoverPicklist ariaLabel="Day" className="bt-picker" value={day}
            options={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, index) => ({ value: String(index), label }))}
            onChange={setDay} searchPlaceholder="Search days" />
        </div>
      )}
      {freq === 'custom' && (
        <label className="bt-form-row">Cron (minute hour day month weekday)<input value={custom} onChange={edit(setCustom)} /></label>
      )}
      {kind === 'price' ? <>
        <label className="bt-form-row">Asset<input value={asset} onChange={edit(setAsset)} placeholder="BTC" /></label>
        <label className="bt-form-row">Quote currencies<input value={currencies} onChange={edit(setCurrencies)} placeholder="USD, CHF" /></label>
        <p className="bt-empty-line">Coinbase rates. Percentages compare with the previous successful update.</p>
      </> : <label className="bt-form-row">
        {kind === 'agent' ? 'What should it do?' : 'Message to post'}
        <textarea rows={3} value={prompt} onChange={edit(setPrompt)}
          placeholder={kind === 'agent' ? 'Summarize what changed since yesterday.' : 'Time for a break.'} />
      </label>}
      <p className="bt-empty-line">{describeCron(cron)} (host local time). {kind === 'agent'
        ? `Uses AI each run. Minimum interval ${MIN_ROUTINE_INTERVAL_MINUTES} minutes.`
        : `Posts directly to main chat · No AI. Minimum interval ${DIRECT_INTERVAL_MINUTES} minutes.`}</p>
      {action.feedback}
      <div className="bt-form-footer">
        <button type="button" className="bt-btn is-ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="bt-btn is-primary" disabled={action.busy || !name.trim() || (kind === 'price' ? !asset.trim() || !currencies.trim() : !prompt.trim())}>{action.busy ? 'Saving…' : routine ? 'Save routine' : 'Add routine'}</button>
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

type SettingsForm = { color: string; name: string; personality: string; projectId: string; providerId: string; model: string };

function settingsOf(bot: BotView): SettingsForm {
  return { color: bot.color ?? defaultBotColor(bot.id), name: bot.name, personality: bot.personality, projectId: bot.projectId, providerId: bot.providerId ?? '', model: bot.model ?? '' };
}

function Settings({ bot, onDeleted, visible }: { bot: BotView; onDeleted(): void; visible: boolean }) {
  const action = useAction(bot.id);
  const formId = useId();
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
    setDirty((current) => {
      const next = new Set(current);
      for (const key of Object.keys(patch) as Array<keyof SettingsForm>) {
        if (patch[key] === saved[key]) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    action.clearFeedback();
  };
  const set = (key: keyof SettingsForm) => (e: { target: { value: string } }) => update({ [key]: e.target.value });
  const changed = [...dirty].filter((key) => form[key] !== saved[key]);

  const cancel = () => {
    setForm(saved);
    setDirty(new Set());
    setEditingModel(false);
    action.clearFeedback();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (action.busy || changed.length === 0 || !form.name.trim()) return;
    const patch = Object.fromEntries(changed.map((key) => [key, form[key]]));
    const runtime = changed.some((key) => key === 'providerId' || key === 'model' || key === 'projectId');
    const done = runtime
      ? 'Saved. Runtime settings apply when a new main thread is created.'
      : changed.includes('personality') ? 'Saved. Applies from the next turn.' : 'Changes saved.';
    if (await action.run('update', { patch }, done)) setDirty(new Set());
  };

  const data = catalog.data;
  const providers = withCurrent(data?.providers ?? [], form.providerId);
  const models = withCurrent((data?.models ?? []).map((id) => ({ id, name: id })), form.model);
  const projects = withCurrent(data?.projects ?? [], form.projectId);
  return (
    <>
      <form id={formId} className="settings-field" onSubmit={(event) => void save(event)} aria-label="Bot settings">
        <fieldset disabled={action.busy}>
          <Section label="Identity">
            <div className="bt-form-row">
              <span className="bt-grow">Color</span>
              <ColorPicker value={form.color} savedColor={saved.color} onChange={color => update({ color })} />
            </div>
            <div className="bt-form-row">
              <span className="bt-grow">Name</span>
              <input aria-label="Name" value={form.name} onChange={set('name')} />
            </div>
            <div className="bt-form-row bt-personality-field">
              <span>Personality and role<span className="bt-sub">Applies from the next turn</span></span>
              {visible && <PersonalityEditor value={form.personality} disabled={action.busy} onChange={personality => update({ personality })} />}
            </div>
          </Section>
          <Section label="Provider and model">
            {catalog.error && <p role="alert" className="bt-empty-line bt-alert">Couldn&apos;t load providers: {catalog.error}</p>}
            <div className="bt-form-row">
              <span className="bt-grow">Provider<span className="bt-sub">Applies when a new main thread starts</span></span>
              <PopoverPicklist ariaLabel="Provider" className="bt-picker" value={form.providerId}
                options={[{ value: '', label: 'Project default' }, ...providers.map(row => ({ value: row.id, label: row.name }))]}
                onChange={providerId => { setEditingModel(false); update({ providerId, model: '' }); }}
                searchPlaceholder="Search providers" />
            </div>
            <div className="bt-form-row">
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
            {editingModel && <div className="bt-form-row">
              <span className="bt-grow">Model ID</span>
              <input aria-label="Model ID" value={form.model} onChange={set('model')} autoFocus />
            </div>}
          </Section>
          <Section label="Project and access">
            <div className="bt-form-row">
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
            <div className="bt-form-row"><span className="bt-grow">Access</span><span className="bt-chip is-warn">Full · runs without asking</span></div>
          </Section>
        </fieldset>
      </form>
      <DeleteBot bot={bot} onDeleted={onDeleted} />
      {(changed.length > 0 || action.busy || action.feedback) && (
        <div className="bt-savebar">
          <div className="bt-savebar-message">{action.feedback ?? (action.busy ? 'Saving changes…' : 'Unsaved changes')}</div>
          {(changed.length > 0 || action.busy) && <div className="bt-savebar-actions">
            <button type="button" className="bt-btn is-ghost" disabled={action.busy} onClick={cancel}>Cancel</button>
            <button type="submit" form={formId} className="bt-btn is-primary" disabled={action.busy || !form.name.trim()}>Save</button>
          </div>}
        </div>
      )}
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
        <div className="bt-form-row">
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

function useJobs(botId: string, active = true) {
  const rpc = useRpc();
  const [jobs, setJobs] = useState<BotJobView[] | null>(null);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!active) return;
    const mine = ++seq.current;
    try {
      const rows = (await rpc.call('jobs', { bot: botId })) as BotJobView[];
      if (mine !== seq.current) return;
      setJobs(rows);
      setError('');
    } catch (err) {
      if (mine === seq.current) setError(message(err));
    }
  }, [rpc, botId, active]);
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
        {error && <p role="alert" className="bt-empty-line bt-alert">{error}</p>}
        {jobs === null && !error && <p role="status" className="bt-empty-line">Loading jobs…</p>}
        {jobs?.length === 0 && <p role="status" className="bt-empty-line">No background jobs yet.</p>}
        {jobs?.map((job) => (
          <button key={job.threadId} type="button" className="bt-row" onClick={() => openChat({ name: job.title }, job.threadId)}>
            <span className="bt-grow">
              <span className="bt-row-title">{job.title}</span>
              <span className="bt-sub">{job.archived ? 'archived' : job.status} · {new Date(job.startedAt).toLocaleString()}</span>
            </span>
            <span style={muted} aria-hidden="true">›</span>
          </button>
        ))}
      </Section>
      <Section label="Memory">
        {visible && <BotMemory key={bot.projectId} tag={tag} projectId={bot.projectId} />}
      </Section>
      {visible && bot.isHelper && <HelperLibrary />}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: 'vault', title: 'Vault', component: () => <VaultPanel /> });
  app.slots.threadPanelAction({
    id: 'profile', title: 'Bot profile', icon: 'Bot', layout: 'flush',
    experimental_ownedThreadTitle: BotThreadTitle, experimental_ownedThreadIcon: BotThreadIcon, component: BotThreadProfile
  });
  app.slots.experimental_agentsBoardThreadToggle({ id: 'threads', title: 'Bots', icon: 'Bot' });
  app.slots.navPanel({ id: 'bots', title: 'Bots', icon: 'Bot', component: BotsPanel, experimental_basicSidebarSection: BasicBots });
});
