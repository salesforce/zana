import { useEffect, useState } from 'react';
import { product } from '../lib/product-client.js';
import type { PluginSettingsSnapshot } from '@zana-ai/zcc-domain/product';
import { CheckboxField } from '../components/settings/FormFields.js';

export function PluginSettingsForm({
  snap,
  busy,
  error,
  onSave
}: {
  snap: PluginSettingsSnapshot;
  busy: boolean;
  error: string | null;
  onSave: (key: string, value: string | boolean | undefined) => void;
}) {
  return (
    <section className="settings-section">
      <h3>Plugin settings</h3>
      <p className="settings-help">Persisted on the server for this plugin.</p>
      {Object.entries(snap.descriptors).map(([key, descriptor]) => {
        const value = snap.values[key];
        if (descriptor.type === 'boolean') {
          return (
            <CheckboxField
              key={key}
              label={descriptor.label}
              checked={value === true}
              disabled={busy}
              onChange={(next) => onSave(key, next)}
            />
          );
        }
        if (descriptor.type === 'select' && descriptor.options) {
          return (
            <label key={key} className="settings-field">
              <span>{descriptor.label}</span>
              <select
                value={typeof value === 'string' ? value : ''}
                disabled={busy}
                onChange={(event) => onSave(key, event.target.value)}
              >
                {descriptor.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        return (
          <label key={key} className="settings-field">
            <span>{descriptor.label}</span>
            <input
              type={descriptor.secret ? 'password' : 'text'}
              value={typeof value === 'string' ? value : ''}
              disabled={busy}
              onChange={(event) => onSave(key, event.target.value)}
            />
          </label>
        );
      })}
      {error && <p className="modal-error">{error}</p>}
    </section>
  );
}

/** Host-generated form from `zcc.settings.define` descriptors. */
export function PluginDefinedSettings({ pluginId }: { pluginId: string }) {
  const [snap, setSnap] = useState<PluginSettingsSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    product.pluginApps
      .getSettings(pluginId)
      .then((next) => {
        if (!cancelled) setSnap(next);
      })
      .catch(() => {
        if (!cancelled) setSnap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  if (!snap || Object.keys(snap.descriptors).length === 0) return null;

  const save = async (key: string, value: string | boolean | undefined) => {
    setBusy(true);
    setError(null);
    try {
      const next = await product.pluginApps.setSettings(pluginId, { [key]: value });
      setSnap(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return <PluginSettingsForm snap={snap} busy={busy} error={error} onSave={(key, value) => void save(key, value)} />;
}
