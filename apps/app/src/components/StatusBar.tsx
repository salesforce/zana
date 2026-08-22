import { product } from '../lib/product-client.js';
import { useEffect, useMemo, useState } from 'react';
import { Bot, Clock, Zap, Moon, AlertCircle, Network, Sparkles, Loader2, CheckCircle2, Heart, X } from 'lucide-react';
import { useScheduler, useUpdates } from '../store.js';
import { useAllAgentCards } from '../hooks/useAgentCards.js';
import { isDelegatingAgent, isIdleAgent, type AgentCard } from './AgentBoard.js';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

/** Where the ♥ Star button and the first-run nudge point; opened via the
 *  renderer's window-open handler → shell.openExternal. */
const SPONSOR_URL = 'https://github.com/salesforce/zana';

/**
 * Always-on bottom status strip (inspired by the daemon footers other agent
 * tools ship): a dense, glanceable summary of the whole app — live fleet
 * counters, scheduler/loop state, and the app version. Spans all shell columns
 * in its own grid row. Pure derive off existing stores, so it costs ~nothing
 * and stays in sync without its own polling (the one timer is the schedule
 * countdown, which has to re-tick on its own).
 */

/** Tally an agent card into one fleet bucket. Mirrors the board's lane rules so
 *  the footer can never disagree with the Agents board. `exited` cards (the Done
 *  lane) aren't counted as live. */
function bucketOf(c: AgentCard): 'running' | 'blocked' | 'delegating' | 'idle' | null {
  if (c.session.status === 'exited') return null;
  if (c.state === 'working') return 'running';
  if (c.state === 'blocked') return 'blocked';
  if (isDelegatingAgent(c)) return 'delegating';
  if (isIdleAgent(c)) return 'idle';
  return null;
}

/** Soonest future nextRunAt across enabled, app-owned schedules (Claude /loops
 *  carry no nextRunAt, so they're naturally skipped). Returns ms-until or null. */
function nextRunMs(tasks: ScheduledTask[], now: number): number | null {
  let soonest = Infinity;
  for (const t of tasks) {
    if (!t.enabled || t.external) continue;
    const at = t.status.nextRunAt ? Date.parse(t.status.nextRunAt) : NaN;
    if (Number.isFinite(at) && at > now && at - now < soonest) soonest = at - now;
  }
  return soonest === Infinity ? null : soonest;
}

function formatIn(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

export function StatusBar() {
  const cards = useAllAgentCards();
  const tasks = useScheduler((s) => s.tasks);
  const updateStatus = useUpdates((s) => s.status);
  const updateProgress = useUpdates((s) => s.progress);
  const [appVersion, setAppVersion] = useState('');
  // First-run "star us" nudge: shown once until dismissed/acted on, gated on
  // AppConfig.sponsorPromptDismissed (same pattern as the walkthrough). Starts
  // hidden and only opens once the flag is confirmed absent/false, so it never
  // flashes on a machine that already dismissed it.
  const [showSponsorPrompt, setShowSponsorPrompt] = useState(false);
  // 1Hz tick so the schedule countdown stays live (everything else re-renders
  // off store changes already).
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    product.app.version().then(setAppVersion).catch(() => {});
    product.config
      .get()
      .then((c) => setShowSponsorPrompt(!c.sponsorPromptDismissed))
      .catch(() => {});
  }, []);

  // Open the internal repo (routed to the OS browser by the main window-open
  // handler) and permanently retire the first-run nudge.
  const openSponsor = () => {
    window.open(SPONSOR_URL, '_blank', 'noopener');
    dismissSponsorPrompt();
  };
  const dismissSponsorPrompt = () => {
    setShowSponsorPrompt(false);
    product.config.set({ sponsorPromptDismissed: true }).catch(() => {});
  };

  // Whether any enabled native schedule has a FUTURE run — derived off `tasks`
  // only (not `now`), so it doesn't re-run every tick. Gates the countdown timer.
  const hasUpcoming = useMemo(() => nextRunMs(tasks, Date.now()) !== null, [tasks]);

  // Only tick once a second when there's actually a countdown to refresh. With
  // no upcoming run the footer is fully store-driven, so the interval (and its
  // per-second re-render of an always-mounted component) is pure waste.
  useEffect(() => {
    if (!hasUpcoming) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasUpcoming]);

  const counts = useMemo(() => {
    const c = { running: 0, blocked: 0, delegating: 0, idle: 0, live: 0 };
    for (const card of cards) {
      const b = bucketOf(card);
      if (!b) continue;
      c[b] += 1;
      c.live += 1;
    }
    return c;
  }, [cards]);

  const { scheduleCount, loopCount, next } = useMemo(() => {
    let scheduleCount = 0;
    let loopCount = 0;
    for (const t of tasks) {
      if (t.external) loopCount += 1;
      else if (t.enabled) scheduleCount += 1;
    }
    return { scheduleCount, loopCount, next: nextRunMs(tasks, now) };
  }, [tasks, now]);

  return (
    <>
      {/* First-run nudge: floats just above the footer, dismissible, shows once.
          Both actions (star / close) flip the persisted flag so it never returns —
          the permanent ♥ button below stays regardless. */}
      {showSponsorPrompt && (
        <div className="sponsor-nudge" role="dialog" aria-label="Support Zana">
          <Heart size={16} className="sponsor-nudge-heart" aria-hidden />
          <div className="sponsor-nudge-text">
            <strong>Enjoying Zana?</strong>
            <span>A GitHub ⭐ helps the project — it's free.</span>
          </div>
          <button type="button" className="sponsor-nudge-cta" onClick={openSponsor}>
            Star on GitHub
          </button>
          <button
            type="button"
            className="sponsor-nudge-close"
            onClick={dismissSponsorPrompt}
            title="Dismiss"
            aria-label="Dismiss"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
      <footer className="statusbar" aria-label="App status">
      {/* Fleet */}
      <span className="statusbar-group" title="Live agents across all projects">
        <span className={`statusbar-dot ${counts.live > 0 ? 'is-live' : ''}`} aria-hidden />
        <Bot size={12} aria-hidden />
        <strong>{counts.live}</strong>
        <span className="statusbar-label">agent{counts.live === 1 ? '' : 's'}</span>
      </span>
      <span className="statusbar-sep" aria-hidden />
      <span className="statusbar-group statusbar-counts">
        <span className="statusbar-stat statusbar-stat--running" title="Working">
          <Zap size={11} aria-hidden /> {counts.running}
        </span>
        <span className="statusbar-stat statusbar-stat--blocked" title="Blocked — needs you">
          <AlertCircle size={11} aria-hidden /> {counts.blocked}
        </span>
        <span className="statusbar-stat statusbar-stat--delegating" title="Delegating to sub-agents">
          <Network size={11} aria-hidden /> {counts.delegating}
        </span>
        <span className="statusbar-stat statusbar-stat--idle" title="Idle / at rest">
          <Moon size={11} aria-hidden /> {counts.idle}
        </span>
      </span>

      {/* Scheduler / loops */}
      <span className="statusbar-sep" aria-hidden />
      <span
        className="statusbar-group"
        title={`${scheduleCount} active schedule${scheduleCount === 1 ? '' : 's'}${
          loopCount ? ` · ${loopCount} Claude /loop${loopCount === 1 ? '' : 's'}` : ''
        }`}
      >
        <Clock size={12} aria-hidden />
        <strong>{scheduleCount}</strong>
        <span className="statusbar-label">sched</span>
        {loopCount > 0 && <span className="statusbar-label statusbar-label--loop">+{loopCount} loop</span>}
        {next !== null && <span className="statusbar-next">next in {formatIn(next)}</span>}
      </span>

      {/* Right-aligned version + update affordance. The update states mirror the
          top-of-app UpdateBanner, surfaced here where the version already lives
          so an available update is glanceable even with the banner dismissed. */}
      <span className="statusbar-spacer" />
      {updateStatus.kind === 'available' && (
        <button
          type="button"
          className="statusbar-update statusbar-update--available"
          onClick={() => void product.updates.download({ installNow: true })}
          title={`Update to v${updateStatus.version} now`}
        >
          <Sparkles size={11} aria-hidden />
          Update to v{updateStatus.version}
        </button>
      )}
      {updateStatus.kind === 'downloading' && (
        <span className="statusbar-update" title="Downloading update">
          <Loader2 size={11} className="statusbar-update-spin" aria-hidden />
          {updateProgress ? Math.round(updateProgress.percent) : 0}%
        </span>
      )}
      {updateStatus.kind === 'downloaded' && (
        <button
          type="button"
          className="statusbar-update statusbar-update--ready"
          onClick={() => void product.updates.quitAndInstall()}
          title={`Restart to install v${updateStatus.version}`}
        >
          <CheckCircle2 size={11} aria-hidden />
          Restart to update
        </button>
      )}
      {/* Permanent, low-key support affordance — one click opens the repo. */}
      <button
        type="button"
        className="statusbar-update statusbar-sponsor"
        onClick={openSponsor}
        title="Star Zana on GitHub"
      >
        <Heart size={11} aria-hidden />
        Star
      </button>
      {appVersion && <span className="statusbar-version">app v{appVersion}</span>}
      </footer>
    </>
  );
}
