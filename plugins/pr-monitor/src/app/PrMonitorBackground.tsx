/**
 * Headless background poller — mounted once at app start and never unmounted
 * (see {@link AppModule.background}). The panel can come and go as the user
 * navigates, but this component keeps polling so the sidebar nav-badge count
 * and the panel's instant-paint cache stay fresh.
 *
 * Loop: every `pollIntervalMinutes` (read from settings; defaulted before the
 * user has run the SetupGate), call the main-side `pollAll` capability. On
 * success, stash the result list (and its length) into `host.cache` for the
 * panel and nav-badge to read synchronously. On a delta vs. the previous
 * snapshot, push an inbox entry per changed PR — but only when the user has
 * notifications enabled.
 *
 * The component never renders DOM. Returning `null` is intentional: the only
 * job here is the side-effectful loop.
 *
 * A NOTE ON THE INTERVAL CHANGE PATH: we re-read settings on every tick
 * (cheap — async storage read of one JSON file) rather than wiring a settings
 * change event, so an interval change applies on the NEXT tick at the latest.
 * Acceptable for a minutes-long loop; if the user lowers the interval the
 * change applies after the in-flight wait.
 *
 * A NOTE ON WAKE / FOREGROUND FRESHNESS: the loop is a renderer `setTimeout`
 * chain, so it is frozen while the machine sleeps or the window is hidden
 * (Chromium suspends/throttles background timers). On wake the frozen timer
 * just resumes counting, so the board could stay stale for up to a full
 * interval — the "inaccurate first thing in the morning" symptom. We fix it by
 * re-polling immediately when the window becomes visible or regains focus
 * (`visibilitychange` / `focus`), collapsing the two events with a short
 * cooldown so unlock-then-click doesn't double-fire.
 */

import { useEffect, useRef } from 'react';
import type { ModuleHost } from './host.js';
import {
  type MonitoredPr,
  type PrMonitorSettings,
  type PrStatusDelta,
  DEFAULT_PR_MONITOR_SETTINGS,
  MONITORED_COUNT_CACHE_KEY,
  MONITORED_PRS_CACHE_KEY,
  PREFETCH_AUTHOR_CACHE_KEY,
  PREFETCH_ORGS_CACHE_KEY,
  PREFETCH_REPOS_CACHE_KEY,
  SETTINGS_STORAGE_KEY,
  statusPriority,
} from '../../lib/types.js';
import { computeNotifyDelivery } from '../../lib/notify.js';
import { statusLabel } from './formatHelpers.js';

const MS_PER_MINUTE = 60_000;

/**
 * Escape a PR title before it is interpolated into inbox Markdown link text
 * (AC-INBOX-3.2 / AC-CORE-3.3). A title is attacker-influenced (it's whatever
 * the PR author typed), so `]`, backticks, `*`, `_`, `[`, and `\` are
 * backslash-escaped to stop it breaking out of the `[…]` label or injecting
 * emphasis / code spans. Newlines collapse to spaces so a multi-line title
 * can't inject extra Markdown blocks.
 */
function escapeMarkdownText(s: string): string {
  return s
    .replace(/[\\`*_[\]]/g, '\\$&')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/**
 * Sanitize a PR URL for use as a Markdown link target (AC-INBOX-3.2). Only an
 * `http(s)` URL is emitted as a live link; anything else (javascript:, data:,
 * unparseable) yields '' so the caller renders plain text instead of an unsafe
 * href. `)` and whitespace are percent-encoded so the URL can't close the
 * `(…)` target early or inject trailing Markdown.
 */
function safeMarkdownUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  } catch {
    return '';
  }
  return url.replace(/[)\s]/g, encodeURIComponent);
}

interface PollResult {
  ok: boolean;
  prs?: MonitoredPr[];
  deltas?: PrStatusDelta[];
  error?: string;
}

/** Deliver notification-worthy deltas from either background or manual sync. */
export async function deliverNotifications(
  host: ModuleHost,
  deltas: PrStatusDelta[],
  settings: PrMonitorSettings
): Promise<void> {
  for (const d of deltas) {
    const worsened = statusPriority(d.newStatus) > statusPriority(d.oldStatus);
    const interestingDirection =
      d.newStatus === 'failed' ||
      d.newStatus === 'conflict' ||
      d.newStatus === 'yellow' ||
      d.newStatus === 'green' ||
      d.newStatus === 'closed-merged' ||
      d.newStatus === 'closed-abandoned' ||
      worsened;
    if (!interestingDirection) continue;

    const delivery = computeNotifyDelivery(d.pr, settings);
    if (!delivery.inApp && !delivery.inbox) continue;

    const repo = escapeMarkdownText(d.pr.repo);
    const title = escapeMarkdownText(d.pr.title);
    const href = safeMarkdownUrl(d.pr.url);
    const titleLine = href ? `[${title}](${href})` : title;

    if (delivery.inApp) {
      host.toast(
        `${d.pr.repo}#${d.pr.number}: ${statusLabel(d.oldStatus)} → ${statusLabel(d.newStatus)}`,
        'info'
      );
    }

    if (delivery.inbox && d.pr.projectId) {
      const md =
        `**${repo}#${d.pr.number}** — ${statusLabel(d.oldStatus)} → ` +
        `**${statusLabel(d.newStatus)}**\n\n${titleLine}`;
      try {
        await host.pushInbox({ comments: md, projectId: d.pr.projectId });
      } catch {
        host.toast(
          `PR Monitor: couldn't post inbox notification for ${d.pr.repo}#${d.pr.number}`,
          'error'
        );
      }
    }
  }
}

export default function PrMonitorBackground({ host }: { host: ModuleHost }) {
  // The loop runs forever; use a ref to short-circuit after unmount in case the
  // host ever does tear the background down (Phase 2 contract says no, but the
  // belt-and-braces guard is one boolean).
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    /** Read settings, fall back to defaults if the user hasn't run setup. */
    const readSettings = async (): Promise<PrMonitorSettings> => {
      const s = await host.storage.get<PrMonitorSettings>(SETTINGS_STORAGE_KEY);
      // Merge with defaults so existing users get new fields like badgeMode
      return { ...DEFAULT_PR_MONITOR_SETTINGS, ...s };
    };

    /** Run one poll cycle and schedule the next. */
    const tick = async () => {
      if (!aliveRef.current) return;
      let intervalMin = DEFAULT_PR_MONITOR_SETTINGS.pollIntervalMinutes;
      try {
        const settings = await readSettings();
        host.cache.set('settings', settings);
        // The nav badge reads `badgeMode` from this cached `settings`; refresh it
        // now (BEFORE the poll) so the badge reflects the persisted mode within
        // one tick regardless of the poll outcome — a failing/skipped poll must
        // not leave the badge stuck on its cold-start default ('total').
        host.cache.refreshBadge?.();
        intervalMin = settings.pollIntervalMinutes;
        // Auto-Sync master toggle (R-SYS-002 / AC-SYS-2.2/2.4/6.2). When off, the
        // background poller does no scheduled sync — it still reschedules so a
        // later re-enable resumes on the next tick without an app relaunch. The
        // on-demand Sync control (R-LIST-002) drives pollAll directly, bypassing
        // this loop.
        if (settings.autoSyncEnabled === false) return;
        const res = await host.call<PollResult>('pollAll');
        if (res?.ok && Array.isArray(res.prs)) {
          host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.prs.length);
          host.cache.refreshBadge?.();
          // Notification delivery on a status change — main side computed the
          // deltas (it knows the previous snapshot authoritatively). The
          // renderer applies the R-NOTIF-002/003 delivery AND-chain per delta
          // and translates the transition into user-facing surfaces.
          if (Array.isArray(res.deltas) && res.deltas.length > 0) {
            await deliverNotifications(host, res.deltas, settings);
          }
        }
      } catch (err) {
        // Don't toast on every failure — the panel surfaces errors when the
        // user is actively looking. The background loop just retries.
        // eslint-disable-next-line no-console
        console.warn('[pr-monitor:bg] poll failed:', err);
      } finally {
        if (aliveRef.current) {
          const ms = Math.max(MS_PER_MINUTE, intervalMin * MS_PER_MINUTE);
          timer = setTimeout(() => void tick(), ms);
        }
      }
    };

    /** Prime the cache immediately from the last-known list in storage. */
    const primeCache = async () => {
      try {
        // Prime `settings` too — the nav badge resolves `badgeMode` from it, and
        // without this the first badge paint runs before any tick has cached
        // settings and falls back to the 'total' default even when the user
        // chose 'unread'.
        const settings = await readSettings();
        host.cache.set('settings', settings);
        const res = await host.call<MonitoredPr[]>('listPrs');
        if (Array.isArray(res)) {
          host.cache.set(MONITORED_PRS_CACHE_KEY, res);
          host.cache.set(MONITORED_COUNT_CACHE_KEY, res.length);
        }
        host.cache.refreshBadge?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pr-monitor:bg] cache prime failed:', err);
      }
    };

    /**
     * Prefetch the three Settings collections (orgs / connected repos / author)
     * into `host.cache` so the Settings areas paint from cache the first time
     * they're opened, with no `gh`-backed loading spinner (R-SET-005). Each is
     * best-effort and independent — a failure just leaves that key unset, and the
     * area degrades to its normal `load()` spinner. Runs once at app start
     * alongside the PR cache prime; the areas still refresh themselves on open.
     */
    const prefetchSettings = async () => {
      const jobs: Array<Promise<void>> = [
        host
          .call('listOrgs')
          .then((res) => host.cache.set(PREFETCH_ORGS_CACHE_KEY, res))
          .catch(() => {}),
        host
          .call('listRepos')
          .then((res) => host.cache.set(PREFETCH_REPOS_CACHE_KEY, res))
          .catch(() => {}),
        host
          .call('getAuthor')
          .then((res) => host.cache.set(PREFETCH_AUTHOR_CACHE_KEY, res))
          .catch(() => {}),
      ];
      await Promise.all(jobs);
    };

    // Prime the cache immediately so the panel shows the last-known list on mount,
    // then kick off the first poll after a short delay.
    void primeCache();
    void prefetchSettings();
    timer = setTimeout(() => void tick(), 2_000);

    // Re-poll immediately when the window wakes / comes to the foreground so the
    // board isn't stale after sleep or a long time hidden (see header note).
    // `tick()` reschedules the next interval itself, so we cancel the pending
    // timer first and let the fresh tick own the schedule. A short cooldown
    // collapses visibilitychange+focus firing back-to-back on the same unlock.
    const WAKE_COOLDOWN_MS = 5_000;
    let lastWakePoll = 0;
    const wakePoll = () => {
      if (!aliveRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastWakePoll < WAKE_COOLDOWN_MS) return;
      lastWakePoll = now;
      if (timer) clearTimeout(timer);
      void tick();
    };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') wakePoll();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', wakePoll);
    }

    return () => {
      aliveRef.current = false;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', wakePoll);
      }
    };
  }, [host]);

  return null;
}
