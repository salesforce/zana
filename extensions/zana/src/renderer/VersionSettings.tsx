/**
 * The zana-tickets extension's SETTINGS panel — the `@zana-ai/mcp` version
 * check, relocated here from core Settings during the tickets → extension
 * extraction. Core no longer names Zana anywhere; this settings page is the
 * extension's own, surfaced by core in Settings → Extensions (the SDK
 * `settingsPanel` contribution).
 *
 * The `@zana-ai/mcp` server is installed globally via npm and shared by every
 * Claude Code session; this compares the installed version against npm's latest
 * so the user can copy the upgrade command. Version data comes through the
 * `ticketsApi.getVersionInfo()` seam (the `zana` built-in main module).
 *
 * Reuses the `zana-ver-*` / `settings-*` / `claude-scope-card` classes already
 * defined in core's global stylesheet — they were left in place by the merge, so
 * the relocated card renders identically.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Copy,
  RefreshCw
} from 'lucide-react';
import type { ZanaVersionInfo } from '@shared/zana-types';
import { ticketsApi } from './ticketsApi';

/** Derive the headline badge / status line from the Zana version info. */
function versionState(info: ZanaVersionInfo | null): {
  tone: 'ok' | 'update' | 'warn';
  badge: string;
  message: string;
} {
  if (!info) return { tone: 'warn', badge: 'Unknown', message: '' };
  if (info.updateAvailable) {
    return {
      tone: 'update',
      badge: `Update → ${info.latest}`,
      message: `An update is available: ${info.installed} → ${info.latest}. Run the command below, then reopen your Claude Code sessions.`
    };
  }
  if (info.installed && info.latest && info.installed === info.latest) {
    return { tone: 'ok', badge: 'Up to date', message: `You’re on the latest version (${info.installed}).` };
  }
  // Partial failure (offline, not installed, etc.) — surface the capability's hint.
  return {
    tone: 'warn',
    badge: info.installed ? 'Unknown' : 'Not installed',
    message: info.error ?? 'Could not determine whether an update is available.'
  };
}

export default function VersionSettings() {
  const [info, setInfo] = useState<ZanaVersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    ticketsApi
      .getVersionInfo()
      .then((res) => setInfo(res))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const copyUpgrade = useCallback(() => {
    if (!info?.upgradeCommand) return;
    navigator.clipboard
      .writeText(info.upgradeCommand)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [info]);

  const state = versionState(info);

  return (
    <div className="settings-section zana-version-settings">
      <p className="settings-help">
        The Zana MCP server (<code>@zana-ai/mcp</code>) is installed globally via npm and shared by
        every Claude Code session. This checks your installed version against the latest published
        on npm.
      </p>

      <div className="claude-scope-card">
        <header>
          <h4>
            @zana-ai/mcp
            {info && (
              <span className={`zana-ver-badge zana-ver-badge--${state.tone}`}>{state.badge}</span>
            )}
          </h4>
          <p className="settings-help">Multi-agent orchestrator MCP server</p>
        </header>

        {loading ? (
          <p className="settings-help">Checking…</p>
        ) : failed ? (
          <p className="modal-error">Couldn’t run the version check.</p>
        ) : info ? (
          <>
            <div className="zana-ver-grid">
              <span className="zana-ver-key">Installed</span>
              <span className="zana-ver-val zana-ver-val--mono">{info.installed ?? '—'}</span>
              <span className="zana-ver-key">Latest</span>
              <span className="zana-ver-val zana-ver-val--mono">{info.latest ?? '—'}</span>
            </div>

            <p className={`zana-ver-status zana-ver-status--${state.tone}`}>
              {state.tone === 'ok' && <CheckCircle2 size={14} />}
              {state.tone === 'update' && <ArrowUpCircle size={14} />}
              {state.tone === 'warn' && <AlertTriangle size={14} />}
              <span>{state.message}</span>
            </p>

            {(info.updateAvailable || !info.installed) && (
              <div className="zana-ver-upgrade">
                <code className="settings-code-block zana-ver-cmd">{info.upgradeCommand}</code>
                <button type="button" className="settings-btn" onClick={copyUpgrade}>
                  <Copy size={14} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </>
        ) : null}

        <div className="settings-btn-row">
          <button type="button" className="settings-btn" onClick={load} disabled={loading}>
            <RefreshCw size={14} />
            {loading ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </div>
    </div>
  );
}
