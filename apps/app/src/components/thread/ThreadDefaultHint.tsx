import { useState } from 'react';
import { product } from '../../lib/product-client.js';
import { useData } from '../../store.js';

export function ThreadDefaultHint({ providerId, defaultProviderId, source, selectionSource, onUseDefault, unavailable }: {
  providerId: string;
  defaultProviderId: string | null;
  source: 'project' | 'global';
  selectionSource: 'default' | 'draft' | 'choice';
  onUseDefault: () => void;
  unavailable: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const isDefault = providerId === defaultProviderId;
  return <div className="thread-command-hint thread-default-hint" data-testid="thread-default-hint">
    <span>{selectionSource === 'draft' ? 'Draft harness' : selectionSource === 'choice' ? 'This thread only' : source === 'project' ? 'Project default' : 'Global thread default'}</span>
    {selectionSource !== 'default' && defaultProviderId ? <button type="button" className="settings-btn" onClick={onUseDefault}>Use default</button> : null}
    {!isDefault && !unavailable ? <button type="button" className="settings-btn" disabled={saving} onClick={async () => {
      setSaving(true); setError(false);
      try {
        const config = await product.config.set({ defaultThreadProviderId: providerId });
        useData.setState({ defaultThreadProviderId: config.defaultThreadProviderId ?? null });
      } catch { setError(true); }
      finally { setSaving(false); }
    }}>{saving ? 'Saving…' : 'Set as global thread default'}</button> : null}
    {error ? <span role="alert">Could not save the thread default. Try again.</span> : null}
  </div>;
}
