import { PopoverPicklist } from '../../ui/PopoverPicklist.js';
import type { ComposerSendMode } from '../../../lib/thread-composer-preferences.js';
import { COMPOSER_SEND_MODE_OPTIONS } from './composer-send-mode-options.js';



export function ComposerSendModePicker({
  value,
  onChange,
  disabled
}: {
  value: ComposerSendMode;
  onChange: (value: ComposerSendMode) => void;
  disabled?: boolean;
}) {
  return (
    <PopoverPicklist
      ariaLabel="Send mode"
      title="Send mode"
      value={value}
      disabled={disabled}
      searchable={false}
      triggerClassName="reasoning-effort-picker-trigger"
      triggerTestId="composer-send-mode-picker"
      options={COMPOSER_SEND_MODE_OPTIONS}
      onChange={onChange}
    />
  );
}
