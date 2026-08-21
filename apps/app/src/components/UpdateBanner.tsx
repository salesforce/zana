import { Sparkles, X, Loader2, CheckCircle2 } from 'lucide-react';
import { useUpdates, useUpdateBanner, isUpdateBannerVisible } from '../store.js';

/**
 * App-wide "a new version is available" banner, driven by the electron-updater
 * status stream (`useUpdates`). It mirrors the Settings → About actions in a
 * prominent, top-of-app bar so an update isn't missed:
 *   - `available`   → "Update now" downloads + relaunches into it
 *                     (`updates.download({ installNow: true })`), "Skip" declines
 *                     the version for good (`updates.skip`).
 *   - `downloading` → progress %, actions disabled.
 *   - `downloaded`  → "Restart now" (`updates.quitAndInstall`).
 * The × hides it for this session only; a newer available version OR a staged
 * `downloaded` update un-dismisses it (see the onStatus handler in the store),
 * so a dismiss never buries the "Restart now" prompt. Renders nothing in every
 * other state, so it costs nothing when up to date / in dev (`disabled`).
 */
export function UpdateBanner() {
  const status = useUpdates((s) => s.status);
  const progress = useUpdates((s) => s.progress);
  const dismissed = useUpdateBanner((s) => s.dismissed);
  const dismiss = useUpdateBanner((s) => s.dismiss);

  const kind = status.kind;
  if (!isUpdateBannerVisible(kind, dismissed)) return null;

  const version = status.version;
  const vLabel = version ? `Version ${version}` : 'A new version';
  const pct = progress ? Math.round(progress.percent) : 0;

  return (
    <div className="update-banner" role="status">
      {kind === 'downloaded' ? (
        <CheckCircle2 size={15} className="update-banner-icon" aria-hidden="true" />
      ) : (
        <Sparkles size={15} className="update-banner-icon" aria-hidden="true" />
      )}
      <span className="update-banner-text">
        {kind === 'available' && (
          <>
            <strong>{vLabel} is available.</strong> Update to the latest version.
          </>
        )}
        {kind === 'downloading' && (
          <strong>Downloading {version ? `v${version}` : 'update'}…</strong>
        )}
        {kind === 'downloaded' && (
          <>
            <strong>{vLabel} is ready.</strong> Restart to finish updating.
          </>
        )}
      </span>
      <span className="grow" />

      {kind === 'available' && (
        <>
          <button
            type="button"
            className="update-banner-btn update-banner-btn--primary"
            onClick={() => void window.cc.updates.download({ installNow: true })}
            title="Download the update and relaunch into it"
          >
            Update now
          </button>
          <button
            type="button"
            className="update-banner-btn"
            onClick={() => version && void window.cc.updates.skip(version)}
            disabled={!version}
            title="Don't offer this version again"
          >
            Skip
          </button>
        </>
      )}

      {kind === 'downloading' && (
        <span className="update-banner-progress">
          <Loader2 size={13} className="update-banner-spin" aria-hidden="true" />
          {pct}%
        </span>
      )}

      {kind === 'downloaded' && (
        <button
          type="button"
          className="update-banner-btn update-banner-btn--primary"
          onClick={() => void window.cc.updates.quitAndInstall()}
          title="Quit and install the update now"
        >
          Restart now
        </button>
      )}

      <button
        type="button"
        className="update-banner-close"
        onClick={() => dismiss()}
        aria-label="Dismiss for now"
        title="Dismiss for now"
      >
        <X size={14} />
      </button>
    </div>
  );
}
