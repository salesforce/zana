import { useEffect, useState } from 'react';
import type { AppConfig, PluginRecoveryState } from '@zana-ai/zcc-domain/product';
import { Section, CheckboxField } from '@/components/settings/FormFields';
import { Modal } from '@/components/Modal';
import { pluginRecovery, product } from '@/lib/product-client';
import './DevelopmentView.css';

export function DevelopmentView({ config, onUpdate }: {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => void;
}) {
  const [recovery, setRecovery] = useState<PluginRecoveryState | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [daemonStatus, setDaemonStatus] = useState('');
  const [daemonError, setDaemonError] = useState('');
  const [error, setError] = useState('');
  const busy = starting || recovery?.phase === 'running';

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const state = await pluginRecovery.status();
        if (disposed) return;
        setRecovery(state);
        setError('');
        if (state.phase === 'running') timer = setTimeout(() => void poll(), 750);
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason));
          timer = setTimeout(() => void poll(), 3000);
        }
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [refresh]);

  async function restartDaemon() {
    setRestarting(true); setDaemonError(''); setDaemonStatus('');
    try {
      const result = await product.hosts.relaunchLocal();
      if (!result.ok) throw new Error(result.message);
      setDaemonStatus('Host daemon relaunched. Waiting machines reconnect automatically.');
    } catch (reason) { setDaemonError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRestarting(false); }
  }

  async function restorePlugins() {
    setConfirm(false); setStarting(true); setError('');
    try {
      setRecovery(await pluginRecovery.start());
      setRefresh(value => value + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setStarting(false); }
  }

  return (
    <>
    <Section searchId="development.recovery" anchorId="recovery" title="Recovery" help="Restore the host runtime and plugin code from Settings, even when an agent cannot launch.">
      <div className="development-recovery-row" data-settings-target="development.restart-daemon">
        <div><span className="settings-label">Restart host daemon</span>
          <p className="settings-help">Restart the local service that runs agents and terminals. Running agents and terminals may be interrupted.</p>
        </div>
        <button type="button" className="settings-btn" disabled={restarting || busy} onClick={() => void restartDaemon()}>
          {restarting ? 'Restarting…' : 'Restart host daemon'}
        </button>
      </div>
      {daemonStatus && <p className="settings-help" role="status">{daemonStatus}</p>}
      {daemonError && <p className="settings-help" role="alert">{daemonError}</p>}
      <CheckboxField searchId="development.plugin-safe-mode" label="Plugin safe mode"
        help="Suspend non-bundled plugins and their tools. Turning this off restores plugins that were enabled. Your plugin settings are preserved."
        checked={config.pluginSafeMode ?? false} onChange={v => onUpdate({ pluginSafeMode: v })} />
      <div className="development-recovery-row" data-settings-target="development.hard-plugin-reload">
        <div><span className="settings-label">Hard Plugin reload</span>
          <p className="settings-help">Fetch fresh plugin files from their recorded sources. Bundled plugins use the official runtime for this Zana release. Saved settings, credentials, data and enabled states are preserved.</p>
        </div>
        <button type="button" className="settings-btn" disabled={busy || restarting} onClick={() => setConfirm(true)}>
          {busy ? 'Restoring plugins…' : 'Hard Plugin reload…'}
        </button>
      </div>
      {recovery && recovery.phase !== 'idle' && <div className="development-recovery-result" aria-live="polite" role="status">
        {recovery.phase === 'running'
          ? <p>Restoring {recovery.current ?? 'plugins'}… ({recovery.restored.length + recovery.failed.length + recovery.skipped.length}/{recovery.total})</p>
          : <p>Recovery complete: {recovery.restored.length} restored, {recovery.failed.length} failed, {recovery.skipped.length} skipped.</p>}
        {recovery.failed.length > 0 && <><strong>Could not restore</strong><ul>{recovery.failed.map(item => <li key={item.id}>{item.id}: {item.message}</li>)}</ul></>}
        {recovery.skipped.length > 0 && <><strong>Skipped</strong><ul>{recovery.skipped.map(item => <li key={item.id}>{item.id}: {item.message}</li>)}</ul></>}
      </div>}
      {error && <p className="settings-help" role="alert">{error}</p>}
    </Section>
    <Section searchId="development.bundled-plugins" anchorId="bundled-plugins" title="Bundled plugins" help="Develop and test bundled plugins on this instance.">
      <CheckboxField searchId="development.plugin-development" label="Bundled plugin development"
        help="Allow local source folders to override bundled plugins and automatically rebuild bundled plugins when their sources change. Applies immediately. Turning this off stops source watching and blocks further overrides; currently loaded plugins keep running."
        checked={config.pluginDevelopmentEnabled ?? false} onChange={v => onUpdate({ pluginDevelopmentEnabled: v })} />
    </Section>
    {confirm && <Modal title="Fetch fresh plugin files?" onClose={() => setConfirm(false)} footer={<>
      <button type="button" className="settings-btn" onClick={() => setConfirm(false)}>Cancel</button>
      <button type="button" className="settings-btn" onClick={() => void restorePlugins()}>Fetch and reload</button>
    </>}>
      <p>Restore installed plugins from fresh downloads, including broken agent providers.</p>
      <ul className="development-recovery-confirm">
        <li>Keep plugin settings, credentials, data and enabled states.</li>
        <li>Use compatible published versions and honor explicit version pins.</li>
        <li>Replace local overrides of bundled plugins with the official runtime. Restored files remain in use after restarting Zana.</li>
        <li>Keep local-only plugins and report those without a published recovery source.</li>
      </ul>
      <p>Active plugin work may be interrupted. Local source folders are preserved.</p>
    </Modal>}
    </>
  );
}
