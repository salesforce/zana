/**
 * System area — "Auto-Sync Scheduling" (R-SYS-*).
 *
 *  • Enable Auto-Sync — master toggle for background polling.
 *  • Sync Interval — fixed 4-option dropdown (15/30/60/120 min, OQ-SYS-5),
 *    always editable even when auto-sync is off (it governs the next run once
 *    re-enabled). Main clamps to [15, 120].
 *  • Sync Status — Next sync (countdown + clock or "—"), Last sync (relative +
 *    clock or empty), and exactly two counts: repositories checked + monitored
 *    PRs.
 *  • Sync All Now — one-off immediate sync (RefreshCw).
 *
 * "Enable Auto-Sync" persists to {@link PrMonitorSettings.autoSyncEnabled}
 * (default true). When off, no Next-sync is surfaced; the interval dropdown
 * stays editable so it governs the next run once re-enabled.
 */

import { useEffect, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import type { ModuleHost } from '../host.js';
import {
  type PrMonitorSettings,
  type MonitoredPr,
  MONITORED_PRS_CACHE_KEY,
} from '../../../lib/types.js';
import { formatRelative } from '../formatHelpers.js';
import { AreaHeader } from './ui.js';

const INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 120, label: 'Every 2 hours' },
];

const MIN_INTERVAL = 15;

/** Short wall-clock time (e.g. "3:42 PM"). */
function clockOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "in 12m" / "in 1h 3m" — coarse countdown to a future epoch. */
function countdownTo(ms: number, now: number): string {
  const diff = Math.max(0, ms - now);
  const mins = Math.round(diff / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

export function SystemArea({
  settings,
  update,
  host,
}: {
  settings: PrMonitorSettings;
  update: (patch: Partial<PrMonitorSettings>) => void;
  host: ModuleHost;
}) {
  const [prs, setPrs] = useState<MonitoredPr[]>(
    () => host.cache.get<MonitoredPr[]>(MONITORED_PRS_CACHE_KEY) ?? []
  );
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Mirror the PR cache + tick a clock so the countdown stays live.
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = host.cache.get<MonitoredPr[]>(MONITORED_PRS_CACHE_KEY);
      if (next) setPrs((prev) => (prev === next ? prev : next));
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [host]);

  const autoSyncEnabled = settings.autoSyncEnabled ?? true;
  const interval = INTERVAL_OPTIONS.some((o) => o.value === settings.pollIntervalMinutes)
    ? settings.pollIntervalMinutes
    : MIN_INTERVAL;

  // Derived sync status. Last sync = newest lastChecked across PRs; next = last +
  // interval (only meaningful when auto-sync is on and something has synced).
  const lastSync = prs.reduce((max, p) => Math.max(max, p.lastChecked || 0), 0);
  const nextSync = autoSyncEnabled && lastSync ? lastSync + interval * 60000 : 0;
  const repoCount = new Set(prs.map((p) => p.repo)).size;

  const syncNow = async () => {
    setSyncing(true);
    try {
      const res = await host.call<{ ok: boolean; prs?: MonitoredPr[] }>('pollAll');
      if (res?.ok && Array.isArray(res.prs)) {
        setPrs(res.prs);
        host.cache.set(MONITORED_PRS_CACHE_KEY, res.prs);
      }
    } catch (err) {
      host.toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="prm-area">
      <AreaHeader
        title="Auto-Sync Scheduling"
        subtitle="Automatically sync PRs from all repositories on a schedule"
      />

      <label className="prm-checkbox-row">
        <input
          type="checkbox"
          checked={autoSyncEnabled}
          onChange={(e) => update({ autoSyncEnabled: e.target.checked })}
        />
        <span>
          <strong>Enable Auto-Sync</strong>
          <small>Automatically check all repositories for new PRs and sync statuses.</small>
        </span>
      </label>

      <div className="prm-field">
        <label className="prm-field-label">Sync Interval</label>
        <select
          className="prm-input prm-input--select"
          value={interval}
          onChange={(e) => {
            const raw = Number(e.target.value);
            if (Number.isFinite(raw)) update({ pollIntervalMinutes: raw });
          }}
        >
          {INTERVAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="prm-field-hint">
          How often to check all active repositories for new pull requests.
        </span>
      </div>

      <section className="prm-subsection">
        <h4 className="prm-subsection-title">Sync Status</h4>
        <div className="prm-sync-status">
          <div className="prm-kv">
            <span className="prm-field-label">Next sync</span>
            <span>
              {nextSync ? (
                <>
                  {countdownTo(nextSync, now)} <span className="prm-field-hint">· {clockOf(nextSync)}</span>
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="prm-kv">
            <span className="prm-field-label">Last sync</span>
            <span>
              {lastSync ? (
                <>
                  {formatRelative(lastSync)} <span className="prm-field-hint">· {clockOf(lastSync)}</span>
                </>
              ) : (
                ''
              )}
            </span>
          </div>
          <div className="prm-sync-counts">
            <span className="prm-sync-count">
              <strong>{repoCount}</strong> repositories checked
            </span>
            <span className="prm-sync-count">
              <strong>{prs.length}</strong> monitored PRs
            </span>
          </div>
        </div>

        <button
          type="button"
          className="prm-btn prm-btn--primary prm-btn--inline"
          onClick={() => void syncNow()}
          disabled={syncing}
        >
          {syncing ? <Loader2 size={13} className="prm-spin" /> : <RefreshCw size={13} />}
          <span>Sync All Now</span>
        </button>
      </section>
    </div>
  );
}
