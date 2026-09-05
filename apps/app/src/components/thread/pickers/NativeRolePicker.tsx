import { RefreshCw } from 'lucide-react';
import { PopoverPicklist } from '../../ui/PopoverPicklist.js';
import { ComposerModeIcon } from './composer-mode-icon.js';
import { composerWorkModeForNativeLabel } from './composer-mode.js';

export type NativeRoleOption = { value: string; name?: string };

const REFRESH_VALUE = '__refresh__';

export function NativeRolePicker({
  value,
  options,
  onChange,
  onRefresh,
  disabled,
  ariaLabel = 'Native role',
  refreshLabel = 'Refresh roles'
}: {
  value: string | undefined;
  options: readonly NativeRoleOption[];
  onChange: (value: string | undefined) => void;
  onRefresh: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  refreshLabel?: string;
}) {
  if (options.length === 0) return null;
  const selected = options.find((option) => option.value === value) ?? options[0];
  const selectedMode = composerWorkModeForNativeLabel(selected?.value ?? '', selected?.name);
  const selectedLabel = selected?.name ?? selected?.value ?? ariaLabel;
  return (
    <PopoverPicklist
      ariaLabel={ariaLabel}
      title={`${selectedLabel} (Shift+Tab)`}
      ariaKeyshortcuts="Shift+Tab"
      value={selected?.value ?? ''}
      disabled={disabled}
      searchable
      searchPlaceholder={`Search ${ariaLabel.toLowerCase()}…`}
      triggerClassName="composer-mode-picker-trigger"
      triggerTestId="native-role-picker-trigger"
      triggerIcon={<ComposerModeIcon mode={selectedMode} />}
      options={[
        ...options.map((option) => {
          const label = option.name ?? option.value;
          return {
            value: option.value,
            label,
            content: (
              <span className="composer-mode-picker-row-label">
                <ComposerModeIcon mode={composerWorkModeForNativeLabel(option.value, option.name)} />
                {label}
              </span>
            )
          };
        }),
        {
          value: REFRESH_VALUE,
          label: refreshLabel,
          sticky: true,
          content: (
            <span className="reasoning-effort-picker-row-label">
              <RefreshCw size={14} aria-hidden="true" />
              {refreshLabel}
            </span>
          )
        }
      ]}
      onChange={(next) => {
        if (next === REFRESH_VALUE) {
          onRefresh();
          return;
        }
        onChange(next || undefined);
      }}
    />
  );
}
