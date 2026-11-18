import { useState } from 'react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { Field } from '@/components/settings/FormFields';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { PERMISSION_MODE_OPTIONS } from '@/components/thread/pickers/permission-mode-options';

export function DefaultThreadPermissionsField({ value, onChange }: {
  value: AppConfig['defaultThreadPermissionMode'];
  onChange: (value: AppConfig['defaultThreadPermissionMode']) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <>
    <Field
      searchId="composer.default-permissions"
      label="Default permissions"
      layout="row"
      help="Used by Modern and CLI composers and direct thread actions such as Reply in thread. Explicit launch and harness choices take priority. Existing threads keep their permissions."
    >
      <PopoverPicklist
        ariaLabel="Default permissions"
        value={value ?? 'legacy'}
        options={[
          { value: 'legacy', label: 'Keep existing defaults', description: 'Preserve current composer and harness defaults.' },
          ...PERMISSION_MODE_OPTIONS.map(({ value, label, description, tone }) => ({ value, label, description, tone }))
        ]}
        searchable={false}
        disabled={busy}
        onChange={(next) => {
          setBusy(true);
          setError(null);
          void onChange(next === 'legacy' ? null : next as NonNullable<AppConfig['defaultThreadPermissionMode']>)
            .catch(() => setError('Could not save default permissions. Try again.'))
            .finally(() => setBusy(false));
        }}
      />
    </Field>
    {error ? <p role="alert" className="settings-help">{error}</p> : null}
  </>;
}
