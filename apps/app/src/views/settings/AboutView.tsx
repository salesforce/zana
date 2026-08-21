import { useState, useEffect } from 'react';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  RotateCw,
  Info,
  type LucideIcon
} from 'lucide-react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { useUpdates, openWhatsNewAll } from '@/store';
import { Section, Field, CheckboxField } from '@/components/settings/FormFields';

type UpdateTone = 'ok' | 'busy' | 'action' | 'warn' | 'muted';

/**
 * Icon + tone + a short title (bold, primary) and optional detail (muted, second
 * line) for the current update status. The card in {@link AboutTab} renders
 * `title` prominently and `detail` beneath it; older call-sites can still read
 * `title` alone as the one-liner.
 */
function updateStatusView(
  status: import('@zana-ai/zcc-domain/product').UpdateStatus,
  progress: import('@zana-ai/zcc-domain/product').UpdateProgress | null
): { tone: UpdateTone; Icon: LucideIcon; title: string; detail?: string } {
  switch (status.kind) {
    case 'idle':
      return {
        tone: 'muted',
        Icon: Info,
        title: 'No update check yet',
        detail: 'Check for updates to see if a newer version is available.'
      };
    case 'disabled':
      return {
        tone: 'muted',
        Icon: Info,
        title: 'Auto-update unavailable',
        detail: 'Updates only work in the packaged app, not a dev build.'
      };
    case 'checking':
      return { tone: 'busy', Icon: Loader2, title: 'Checking for updates…' };
    case 'available':
      return {
        tone: 'action',
        Icon: Sparkles,
        title: `Version ${status.version ?? 'update'} is available`,
        detail: 'Download and restart now, or install it on your next quit.'
      };
    case 'not-available':
      return { tone: 'ok', Icon: CheckCircle2, title: 'You’re on the latest version' };
    case 'downloading':
      return {
        tone: 'busy',
        Icon: Loader2,
        title: `Downloading ${status.version ? `v${status.version}` : 'update'}…`,
        detail: progress ? `${Math.round(progress.percent)}% complete` : undefined
      };
    case 'downloaded':
      return {
        tone: 'ok',
        Icon: CheckCircle2,
        title: `Version ${status.version ?? 'update'} is ready`,
        detail: 'Restart to finish installing.'
      };
    case 'error':
      return {
        tone: 'warn',
        Icon: AlertTriangle,
        title: 'Update check failed',
        detail: status.message ?? 'Check your network / VPN and try again.'
      };
  }
}

/** Public release feed — the About tab links here for full release notes. */
const RELEASE_NOTES_URL = 'https://github.com/salesforce/zana/releases';

/**
 * The update-status "card": a status-first surface (icon + title + detail on the
 * left, contextual actions on the right, a progress bar while downloading) that
 * replaces the old flat status-line + button-row. Reads the single source of
 * truth (`useUpdates`) — the same stream the top-of-app {@link UpdateBanner}
 * consumes — so the two never disagree. All 8 status kinds render here (the
 * banner only shows the urgent ones), so this is also the home for `error` /
 * `idle` / `not-available`, which the banner deliberately hides.
 */
function UpdateStatusCard() {
  const status = useUpdates((s) => s.status);
  const progress = useUpdates((s) => s.progress);

  const checking = status.kind === 'checking';
  const available = status.kind === 'available';
  const downloading = status.kind === 'downloading';
  const downloaded = status.kind === 'downloaded';
  const error = status.kind === 'error';

  const { tone, Icon, title, detail } = updateStatusView(status, progress);
  const spinning = tone === 'busy';
  const pct = progress ? Math.round(progress.percent) : 0;

  return (
    <div className="settings-update-card" data-tone={tone} role="status" aria-live="polite">
      <Icon
        size={18}
        className={`settings-update-icon${spinning ? ' settings-spin' : ''}`}
        aria-hidden="true"
      />
      <div className="settings-update-body">
        <div className="settings-update-title">{title}</div>
        {detail && <div className="settings-update-detail">{detail}</div>}
        {downloading && (
          <div
            className="settings-update-progress"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Download progress"
          >
            <div className="settings-update-progress-bar" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="settings-update-actions">
        {available && (
          <>
            {/* Notify-only: nothing downloads until one of these is clicked. */}
            <button
              type="button"
              className="settings-update-btn settings-update-btn--primary"
              onClick={() => void window.cc.updates.download({ installNow: true })}
              title="Download the update and relaunch into it"
            >
              <Download size={13} aria-hidden="true" /> Download &amp; restart
            </button>
            <button
              type="button"
              className="settings-update-btn"
              onClick={() => void window.cc.updates.download({ installNow: false })}
              title="Download in the background; install on your next quit"
            >
              Install on quit
            </button>
            {status.version && (
              <button
                type="button"
                className="settings-update-btn settings-update-btn--ghost"
                onClick={() => void window.cc.updates.skip(status.version!)}
                aria-label={`Skip version ${status.version}`}
                title="Don't offer this version again"
              >
                Skip
              </button>
            )}
          </>
        )}
        {downloaded && (
          <button
            type="button"
            className="settings-update-btn settings-update-btn--primary"
            onClick={() => void window.cc.updates.quitAndInstall()}
            title="Quit and install the update now"
          >
            <RotateCw size={13} aria-hidden="true" /> Restart now
          </button>
        )}
        {(error || (!available && !downloaded && !downloading)) && (
          <button
            type="button"
            className="settings-update-btn"
            disabled={checking || status.kind === 'disabled'}
            onClick={() => void window.cc.updates.check()}
            title="Check the release feed for a newer version"
          >
            {checking ? 'Checking…' : error ? 'Retry' : 'Check for updates'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * About tab — app version, the update-status card, and links. Promoted out of
 * the Global tab into its own trailing "App" settings category (About is
 * app-level meta, not configuration). The optional dev/QA "simulate update"
 * controls live here too, gated behind {@link AppConfig.enableUpdateSimulation}.
 */
export function AboutView({
  config,
  onUpdate
}: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}) {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    window.cc.app.version().then(setVersion).catch(() => {});
  }, []);

  const simEnabled = config.enableUpdateSimulation ?? false;

  return (
    <>
      <Section title="About" help="App version and updates.">
        <Field label="Version" mono>
          <input type="text" value={version || '…'} readOnly spellCheck={false} />
        </Field>
        <UpdateStatusCard />
        <p className="settings-help">
          <button type="button" className="link-button" onClick={() => void openWhatsNewAll()}>
            What’s new
          </button>{' '}
          shows the release notes in-app, or{' '}
          <a href={RELEASE_NOTES_URL} target="_blank" rel="noopener noreferrer">
            view them on GitHub
          </a>
          .
        </p>
      </Section>

      <Section
        title="Developer"
        help="Diagnostics for testing the update flow. Off by default; intended for QA and development."
      >
        <CheckboxField
          label="Enable update simulation (dev/QA)"
          help="Reveals a “Simulate update” button that walks the full available → downloading → downloaded flow WITHOUT contacting the release feed or downloading anything. Nothing is actually installed — the “Restart now” button is a no-op while simulating. Off by default."
          checked={simEnabled}
          onChange={(v) => onUpdate({ enableUpdateSimulation: v })}
        />
        {simEnabled && (
          <div className="settings-btn-row">
            <button
              type="button"
              className="settings-btn"
              onClick={() => void window.cc.updates.simulate?.('9.9.9')}
              title="Emit a fake update flow to exercise the banner + About card"
            >
              Simulate update (v9.9.9)
            </button>
          </div>
        )}
      </Section>
    </>
  );
}

export { AboutView as AboutTab };
