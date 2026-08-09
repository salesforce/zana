/**
 * Slack settings panel — configure outbound notifications + document the two
 * MCP-driven Slack agent schedules (mention triage + [agent] runner).
 *
 * Tier A: settings surface for the existing Slack agents (from template-store).
 * Tier B: automatic lifecycle notifications (session blocked/exit).
 */

import { useState, useEffect, useCallback } from 'react';
import type { ModuleHost } from '@zana-ai/zcc-extension-sdk/renderer';
import {
  type SlackConfig,
  type SlackBotConfig,
  DEFAULT_SLACK_CONFIG,
  DEFAULT_SLACK_BOT_CONFIG
} from '../shared/types.js';

interface SlackPanelProps {
  host: ModuleHost;
}

interface BotStatus {
  running: boolean;
  authGaveUp: boolean;
  misconfigured?: string | null;
  pendingLaunches: number;
  budget?: { conversation: number; threads: number };
  lastError?: string;
}

export default function SlackPanel({ host }: SlackPanelProps) {
  const [config, setConfig] = useState<SlackConfig>(DEFAULT_SLACK_CONFIG);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [authDetect, setAuthDetect] = useState<string | null>(null);

  // Load config from storage on mount.
  useEffect(() => {
    host.storage.get<SlackConfig>('config').then((saved) => {
      if (saved) setConfig({ ...DEFAULT_SLACK_CONFIG, ...saved, bot: { ...DEFAULT_SLACK_BOT_CONFIG, ...saved.bot } });
    });
  }, [host]);

  // Patch just the bot sub-config.
  const saveBot = useCallback(
    (patch: Partial<SlackBotConfig>) => {
      setConfig((prev) => {
        const updated = { ...prev, bot: { ...prev.bot, ...patch } };
        host.storage.set('config', updated);
        return updated;
      });
    },
    [host]
  );

  // Save config to storage (debounced).
  const saveConfig = useCallback(
    (updated: SlackConfig) => {
      setConfig(updated);
      host.storage.set('config', updated);
    },
    [host]
  );

  // Test connection.
  const handleTest = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await host.call<{ ok: boolean; error?: string }>('testConnection');
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    } finally {
      setIsTesting(false);
    }
  }, [host]);

  // NOTE: the launch-bridge, reply-bridge, and lifecycle-notify subscriptions
  // used to live here, but a panel unmounts on nav change — which silently
  // killed the bot the moment the user looked away. They now live in the
  // always-mounted SlackBot background (see SlackBot.tsx / module.ts). The panel
  // keeps only its settings UI + the status poll below.

  // Poll bot status for the settings panel while enabled.
  useEffect(() => {
    if (!config.bot.enabled) {
      setBotStatus(null);
      return;
    }
    let active = true;
    const tick = () => {
      host
        .call<BotStatus>('botStatus')
        .then((s) => {
          if (active) setBotStatus(s);
        })
        .catch(() => undefined);
    };
    const timer = setInterval(tick, 3000);
    tick();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [host, config.bot.enabled]);

  // Toggle the bot: persist, then start/stop the main-process loop.
  const toggleBot = useCallback(
    async (enabled: boolean) => {
      saveBot({ enabled });
      try {
        if (enabled) {
          const res = await host.call<{ ok: boolean; error?: string }>('startBot');
          if (!res.ok) host.toast(`Slack bot: ${res.error}`, 'error');
        } else {
          await host.call('stopBot');
        }
      } catch (err) {
        host.toast(`Slack bot: ${String(err)}`, 'error');
      }
    },
    [host, saveBot]
  );

  // Resolve the authorized user id from the bot token.
  const detectUser = useCallback(async () => {
    setAuthDetect('…');
    try {
      const res = await host.call<{ ok: boolean; userId?: string; team?: string; error?: string }>(
        'botAuthTest'
      );
      if (res.ok && res.userId) {
        saveBot({ authedUserId: res.userId });
        setAuthDetect(`✅ ${res.userId}${res.team ? ` (${res.team})` : ''}`);
      } else if (res.ok) {
        // MCP transport: connected, but the gateway can't reveal the Slack id.
        setAuthDetect('✅ Gateway reachable — enter your Slack user id above.');
      } else {
        setAuthDetect(`❌ ${res.error ?? 'failed'}`);
      }
    } catch (err) {
      setAuthDetect(`❌ ${String(err)}`);
    }
  }, [host, saveBot]);

  const projects = host.listProjects();

  return (
    <>
      {/* Tier A: reference to existing Slack agents */}
      <section className="settings-section">
        <h3>MCP-Driven Slack Agents</h3>
        <p className="settings-help settings-section-help">
          ZCC includes two builtin Slack agent schedules that use the Slack MCP tools:
        </p>
        <ul className="settings-help">
          <li>
            <strong>slack-mention-triage</strong> (every 30 min) — scans for @mentions, DMs, and
            thread replies; classifies them (action/fyi/noise); pushes a digest to your inbox.
          </li>
          <li>
            <strong>slack-agent-runner</strong> (every 15 min) — finds your messages starting with{' '}
            <code>[agent]</code>, runs the instruction in the project cwd, replies in-thread.
          </li>
        </ul>
        <p className="settings-help">
          These are configured in the <strong>Scheduler</strong> panel. To enable them, create a
          schedule from the <code>builtin:slack-mention-triage</code> or{' '}
          <code>builtin:slack-agent-runner</code> templates.
        </p>
      </section>

      {/* Tier B: automatic outbound notifications */}
      <section className="settings-section">
        <h3>Automatic Lifecycle Notifications</h3>
        <p className="settings-help settings-section-help">
          ZCC can automatically post to Slack when sessions need your attention or finish.
        </p>

        <div className="settings-field">
          <label>
            <span className="settings-label">Webhook URL (easiest)</span>
            <input
              type="text"
              value={config.webhookUrl ?? ''}
              onChange={(e) => saveConfig({ ...config, webhookUrl: e.target.value || undefined })}
              placeholder="https://hooks.slack.com/services/..."
            />
          </label>
          <p className="settings-help">
            Create an{' '}
            <a
              className="settings-link"
              href="https://api.slack.com/messaging/webhooks"
              onClick={(e) => {
                e.preventDefault();
                host.openExternal('https://api.slack.com/messaging/webhooks');
              }}
            >
              Incoming Webhook
            </a>{' '}
            in your Slack workspace.
          </p>
        </div>

        <div className="settings-field">
          <label>
            <span className="settings-label">Bot Token (alternative, for Web API)</span>
            <input
              type="password"
              value={config.botToken ?? ''}
              onChange={(e) => saveConfig({ ...config, botToken: e.target.value || undefined })}
              placeholder="xoxb-..."
            />
          </label>
        </div>

        <div className="settings-field">
          <label>
            <span className="settings-label">Default Channel (for bot token)</span>
            <input
              type="text"
              value={config.defaultChannel ?? ''}
              onChange={(e) =>
                saveConfig({ ...config, defaultChannel: e.target.value || undefined })
              }
              placeholder="#zcc-notifications"
            />
          </label>
        </div>

        <div className="settings-field">
          <span className="settings-label">Notify on:</span>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={config.notifyOn.sessionBlocked}
              onChange={(e) =>
                saveConfig({
                  ...config,
                  notifyOn: { ...config.notifyOn, sessionBlocked: e.target.checked }
                })
              }
            />
            <span>Session blocked (needs your input)</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={config.notifyOn.sessionExit}
              onChange={(e) =>
                saveConfig({
                  ...config,
                  notifyOn: { ...config.notifyOn, sessionExit: e.target.checked }
                })
              }
            />
            <span>Session finished (exit)</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={config.notifyOn.scheduledComplete}
              onChange={(e) =>
                saveConfig({
                  ...config,
                  notifyOn: { ...config.notifyOn, scheduledComplete: e.target.checked }
                })
              }
            />
            <span>Scheduled run completes</span>
          </label>
        </div>

        <div className="settings-field">
          <label>
            <span className="settings-label">Debounce (ms)</span>
            <input
              type="number"
              value={config.debounceMs}
              onChange={(e) =>
                saveConfig({ ...config, debounceMs: Number(e.target.value) || 5000 })
              }
              min="0"
              step="1000"
            />
          </label>
          <p className="settings-help">Group rapid-fire notifications</p>
        </div>

        <div className="settings-btn-row">
          <button
            type="button"
            className="settings-btn"
            onClick={handleTest}
            disabled={isTesting || (!config.webhookUrl && !config.botToken)}
          >
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>
        </div>

        {testResult && (
          <div className={`settings-status ${testResult.ok ? 'settings-status--ok' : 'settings-status--err'}`}>
            {testResult.ok ? '✅ Test notification sent!' : `❌ ${testResult.error}`}
          </div>
        )}
      </section>

      {/* Tier C: live bot */}
      <section className="settings-section">
        <h3>Live Bot</h3>
        <p className="settings-help settings-section-help">
          Watch a channel and act on commands from you. Post <code>run &lt;prompt&gt;</code> to launch a
          Claude session (it replies in-thread), or <code>status</code> / <code>help</code>. Runs only
          while ZCC is open. A launched session's thread becomes a live log: the bot posts there when
          it needs your input and when it finishes (replacing the generic channel notify below for bot
          sessions).
        </p>

        <div className="settings-field settings-field--check">
          <label className="settings-check">
            <input
              type="checkbox"
              checked={config.bot.enabled}
              onChange={(e) => void toggleBot(e.target.checked)}
            />
            <span>Enable the live bot</span>
            {botStatus && (
              <span
                className={`settings-status-inline${botStatus.running ? ' settings-status-inline--ok' : ''}`}
              >
                — {botStatus.running ? 'running' : 'stopped'}
                {botStatus.authGaveUp ? ' (auth circuit tripped — recheck token)' : ''}
                {botStatus.misconfigured ? ` (channel ${botStatus.misconfigured})` : ''}
              </span>
            )}
          </label>
        </div>

        {/* Transport: reuse the AI Expert Suite MCP (no token) vs a bot token. */}
        <div className="settings-field">
          <span className="settings-label">Slack connection</span>
          <label className="settings-check">
            <input
              type="radio"
              name="slack-transport"
              checked={config.bot.transport === 'mcp'}
              onChange={() => saveBot({ transport: 'mcp' })}
            />
            <span>
              AI Expert Suite Slack{' '}
              <span className="settings-status-inline">
                — no token; reuses that app's Slack login (it must be running)
              </span>
            </span>
          </label>
          <label className="settings-check">
            <input
              type="radio"
              name="slack-transport"
              checked={config.bot.transport === 'web'}
              onChange={() => saveBot({ transport: 'web' })}
            />
            <span>
              Bot token{' '}
              <span className="settings-status-inline">
                — self-contained; paste an <code>xoxb-</code> token below
              </span>
            </span>
          </label>
        </div>

        <div className="settings-field">
          <label>
            <span className="settings-label">
              Channel ID (the <code>C…</code>/<code>G…</code> id, not <code>#name</code>)
            </span>
            <input
              type="text"
              value={config.bot.channelId ?? ''}
              onChange={(e) => saveBot({ channelId: e.target.value.trim() || undefined })}
              placeholder="C0123456789"
            />
          </label>
        </div>

        <div className="settings-field">
          <span className="settings-label">
            Authorized user (only this Slack user can drive the bot)
          </span>
          <div className="settings-btn-row">
            <input
              type="text"
              style={{ flex: 1 }}
              value={config.bot.authedUserId ?? ''}
              onChange={(e) => saveBot({ authedUserId: e.target.value.trim() || undefined })}
              placeholder="U0123456789"
            />
            <button
              type="button"
              className="settings-btn"
              onClick={() => void detectUser()}
              disabled={config.bot.transport === 'web' && !config.botToken}
            >
              {config.bot.transport === 'mcp' ? 'Test connection' : 'Detect from token'}
            </button>
          </div>
          {config.bot.transport === 'mcp' && (
            <p className="settings-help">
              The gateway doesn’t expose your Slack id — enter it manually (your <code>U…</code> id).
              “Test connection” just checks the AI Expert Suite gateway is reachable.
            </p>
          )}
          {authDetect && <p className="settings-help">{authDetect}</p>}
        </div>

        <div className="settings-field">
          <label>
            <span className="settings-label">Launch sessions into</span>
            <select
              value={config.bot.defaultProjectId ?? ''}
              onChange={(e) => saveBot({ defaultProjectId: e.target.value || undefined })}
            >
              <option value="">Active project (whatever's selected)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="settings-field">
          <label>
            <span className="settings-label">Poll interval (ms)</span>
            <input
              type="number"
              value={config.bot.pollIntervalMs}
              onChange={(e) => saveBot({ pollIntervalMs: Number(e.target.value) || 3000 })}
              min="2000"
              step="1000"
            />
          </label>
        </div>

        <p className="settings-help">
          The bot token needs scopes: <code>channels:history</code> (or{' '}
          <code>groups:history</code>), <code>reactions:read</code>, plus <code>chat:write</code> for
          replies. When a session needs approval the bot posts a prompt — react{' '}
          <code>:white_check_mark:</code>/<code>:x:</code> to answer it, or use <code>hint</code>/
          <code>cancel</code> in its thread.
        </p>

        {botStatus?.lastError && (
          <div className="settings-status settings-status--err">
            Last error: {botStatus.lastError}
          </div>
        )}
      </section>
    </>
  );
}
