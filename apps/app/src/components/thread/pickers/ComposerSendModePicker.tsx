import { PopoverPicklist } from '../../ui/PopoverPicklist.js';
import type { ComposerSendMode } from '../../../lib/thread-composer-preferences.js';

const OPTIONS: Array<{ value: ComposerSendMode; label: string; description: string }> = [
  { value: 'auto', label: 'Auto', description: 'Send starts a new turn' },
  { value: 'steer', label: 'Steer', description: 'Enter steers a running turn; Cmd/Ctrl+Enter queues' },
  { value: 'queue-if-active', label: 'Queue', description: 'Hold the message until the current turn finishes' }
];

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
      options={OPTIONS}
      onChange={onChange}
    />
  );
}
