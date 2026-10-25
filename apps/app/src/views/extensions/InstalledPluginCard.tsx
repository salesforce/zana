import { useState } from 'react';
import { ArrowUpCircle, ChevronRight } from 'lucide-react';
import { product } from '@/lib/product-client';
import { hasDesktopBridge } from '@/lib/app-surface';
import { resolveIcon } from '@/lib/resolveIcon';
import { useUi } from '@/store';
import { reconcilePluginApps } from '@/plugins/plugin-app-loader';
import { displayIcon, rowDescription, rowEnabled, type HubRow } from './installed-plugins.js';
import { installedIconTone, installedIconUrl } from './installed-collection.js';
import { installedNotRunning, installedRuntimeStatus } from './installed-row-status.js';
import { installedCapabilities, installedSource } from './plugin-presentation.js';
import { refreshPluginAppsAfterToggle, reportPluginEnabledFailure, setHubRowEnabled } from './plugin-row-enabled.js';
import { applyHubPluginUpdate, pluginAvailableVersion } from './plugin-row-update.js';

export function InstalledPluginCard({ row, onOpen, selected = false }: { row: HubRow; onOpen: () => void; selected?: boolean }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const [updating, setUpdating] = useState(false);
  const enabled = pending ?? rowEnabled(row);
  const desktopOnly = !hasDesktopBridge() && !!row.entry && !row.plugin;
  const canToggle = !desktopOnly && (row.plugin != null || row.entry != null);
  const availableVersion = desktopOnly ? null : pluginAvailableVersion(row);
  const runtime = installedRuntimeStatus(row);
  const notRunning =
    !desktopOnly && enabled === true &&
    installedNotRunning({
      ...row,
      plugin: row.plugin ? { ...row.plugin, enabled: true } : null
    });
  const description = rowDescription(row);
  const running = enabled && (row.plugin ? row.plugin.status === 'running' : row.entry?.loaded === true);
  const Icon = resolveIcon(displayIcon(row.module.icon));
  const iconUrl = installedIconUrl(row);
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const runtimeToneClass =
    runtime?.tone === 'error'
      ? 'ext-installed-status--error'
      : runtime?.tone === 'warning'
        ? 'ext-installed-status--warning'
        : 'ext-installed-status--muted';

  const toggle = (next: boolean) => {
    if (!canToggle) return;
    setPending(next);
    void setHubRowEnabled(row, next, product)
      .then((res) => {
        reportPluginEnabledFailure(res, useUi.getState().pushToast);
        if (res.ok) {
          void refreshPluginAppsAfterToggle(() => product.pluginApps.list(), reconcilePluginApps);
        }
      })
      .catch((err) => {
        reportPluginEnabledFailure(
          {
            ok: false,
            message: err instanceof Error ? err.message : 'Failed to update plugin'
          },
          useUi.getState().pushToast
        );
      })
      .finally(() => setPending(null));
  };

  const applyUpdate = () => {
    if (!availableVersion || updating) return;
    setUpdating(true);
    void applyHubPluginUpdate(row, product)
      .then((res) => {
        if (!res.ok) {
          useUi.getState().pushToast(res.message || 'Failed to update plugin', 'error');
          return;
        }
        useUi.getState().pushToast(`Updated ${row.module.title} to ${availableVersion}`);
      })
      .catch((err) => {
        useUi.getState().pushToast(
          err instanceof Error ? err.message : 'Failed to update plugin',
          'error'
        );
      })
      .finally(() => setUpdating(false));
  };

  return (
    <div className={`ext-installed-row${enabled ? '' : ' is-disabled'}${selected ? ' is-selected' : ''}`} data-testid={`plugin-row-${row.module.id}`} role="listitem">
      <button type="button" className="ext-installed-row-open" onClick={onOpen}
        aria-label={`${row.module.title} plugin details`}>

          <span className={`ext-installed-icon ext-installed-icon--${installedIconTone(row.module.id)}${runtime ? ` is-${runtime.tone}` : ''}`}>
            {iconUrl && failedIcon !== iconUrl ? (
              <img src={iconUrl} alt="" onError={() => setFailedIcon(iconUrl)} />
            ) : <Icon size={20} />}
            {runtime ? <span className="ext-installed-icon-badge" aria-hidden="true" /> : null}
          </span>
          <span className="ext-installed-row-copy"><span className="ext-installed-row-title">{row.module.title}</span>
          <span className="ext-installed-row-desc" title={description}>{description}</span></span>
      </button>
      <span className="ext-plugin-capabilities" aria-label="Capabilities">{installedCapabilities(row).map((cap) => <span key={cap}>{cap}</span>)}</span>
      <span className="ext-installed-source">{installedSource(row)}</span>
      <div className="ext-installed-row-trailing">
          {desktopOnly ? <span className="ext-installed-status">Owner desktop</span> : null}
          {runtime ? (
            <button type="button" className={`ext-installed-status ext-installed-health-signal ${runtimeToneClass}`}
              data-testid={`plugin-runtime-status-${row.module.id}`} onClick={onOpen}
              title={runtime.detail} aria-label={`${row.module.title}: ${runtime.label}. Open details`}>
              {runtime.label}
            </button>
          ) : null}
          {availableVersion ? (
            <button type="button" className="ext-installed-update-signal" disabled={updating}
              onClick={applyUpdate} title={`Update to ${availableVersion}`}
              aria-label={`Update ${row.module.title} to ${availableVersion}`}
              data-testid={`plugin-update-signal-${row.module.id}`}>
              <ArrowUpCircle size={12} aria-hidden="true" />
              {updating ? 'Updating…' : 'Update'}
            </button>
          ) : null}
          {notRunning && !runtime ? (
            <span data-testid={`plugin-not-running-${row.module.id}`}
              className={`ext-installed-not-running ${runtimeToneClass}`}>not running</span>
          ) : null}
          {!runtime && !notRunning && !desktopOnly && !availableVersion ? <span className={`ext-installed-runtime${running ? ' is-running' : ''}`}>{enabled ? running ? 'Running' : 'Not running' : 'Disabled'}</span> : null}
      </div>
      <div className="ext-installed-row-toggle">
          {canToggle ? (
            <label className="ext-installed-switch" title={enabled ? 'Disable' : 'Enable'}>
              <input type="checkbox" role="switch" checked={enabled} disabled={pending !== null}
                aria-label={`${enabled ? 'Disable' : 'Enable'} ${row.module.title}${notRunning ? ` (${row.plugin?.status}, not running)` : ''}`}
                onChange={(e) => toggle(e.target.checked)} />
              <span className="ext-installed-switch-ui" aria-hidden="true" />
            </label>
          ) : <span className="ext-installed-switch-spacer" aria-hidden="true" />}
      </div>
      <button type="button" className="ext-installed-chevron icon-btn" aria-label={`Open ${row.module.title}`} onClick={onOpen}><ChevronRight size={15} /></button>
    </div>
  );
}

