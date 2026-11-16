import { useState } from 'react';
import { Field } from '../../components/settings/FormFields.js';
import { PopoverPicklist } from '../../components/ui/PopoverPicklist.js';
import type { RegisteredThreadProvider } from '../../hooks/useRegisteredThreadProviders.js';

export function ThreadProviderDefaultField({ value, providers, onChange, inherit, loading, searchId, help }: {
  searchId?: string;
  help?: string;
  value: string | null | undefined;
  providers: readonly RegisteredThreadProvider[];
  onChange: (providerId: string | null) => Promise<void>;
  /** Present only for a project override. */
  inherit?: string;
  loading?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const options = [...providers].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id))
    .map(row => ({ value: row.id, label: `${row.displayName}${row.available === false ? ' (unavailable)' : ''}`, disabled: row.available === false }));
  if (value && !providers.some(row => row.id === value)) options.unshift({ value, label: `${value} (unavailable)`, disabled: true });
  options.unshift({ value: '', label: inherit === undefined ? 'Choose a harness' : `Use global · ${inherit}`, disabled: inherit === undefined });
  return <Field label="Default for threads" searchId={searchId} layout="row" help={help}>
    <PopoverPicklist value={value ?? ''} ariaLabel="Default for threads" disabled={saving || loading} options={options} onChange={async next => {
      setSaving(true); setError(false);
      try { await onChange(next || null); }
      catch { setError(true); }
      finally { setSaving(false); }
    }} />
    {error ? <span role="alert">Could not save the thread default. Try again.</span> : null}
  </Field>;
}
