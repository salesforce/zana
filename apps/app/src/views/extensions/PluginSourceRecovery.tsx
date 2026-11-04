import { useState } from 'react';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';

export function PluginSourceRecovery({ plugin }: { plugin: PluginAppEntry }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repair = async (action: 'locate' | 'official') => {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await product.pluginApps.repair(plugin.id, action);
      if (!result.ok) {
        if (result.code !== 'CANCELED') setError(result.message ?? 'Plugin recovery failed');
      } else {
        setConfirm(false);
        setMessage('Plugin recovered. Settings and saved data preserved.');
      }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <div>
    <p className="settings-help">The source folder was moved or no longer contains a plugin manifest. Your settings, saved data and enabled state will be kept.</p>
    {confirm ? <div role="group" aria-label="Switch to official distribution?">
      <p>Zana will download the official plugin. Your local source folder will stay on disk.</p>
      <div className="ext-actions">
        <button className="settings-btn primary" disabled={busy} onClick={() => void repair('official')}>{busy ? 'Recovering…' : 'Switch distribution'}</button>
        <button className="settings-btn" disabled={busy} onClick={() => { setConfirm(false); setError(null); }}>Cancel</button>
      </div>
    </div> : <div className="ext-actions">
      {plugin.sourceRecovery?.canLocate && <button className="settings-btn primary" disabled={busy} onClick={() => void repair('locate')}>{busy ? 'Recovering…' : 'Locate moved plugin…'}</button>}
      {plugin.sourceRecovery?.canSwitchOfficial && <button className="settings-btn" disabled={busy} onClick={() => setConfirm(true)}>Switch to official distribution…</button>}
    </div>}
    {error && <p className="modal-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
