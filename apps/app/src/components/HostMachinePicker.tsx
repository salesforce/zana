import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { hostPickerDescription, hostPickerLabel } from './composer-host-status.js';

export function HostMachinePicker({
  hosts,
  value,
  onChange,
  ariaLabel = 'Machine',
  includeDisconnected = false,
  alwaysShow = false
}: {
  hosts: Host[];
  value?: string;
  onChange: (hostId: string) => void;
  ariaLabel?: string;
  includeDisconnected?: boolean;
  alwaysShow?: boolean;
}) {
  const connected = hosts.filter((host) => host.status === 'connected');
  const visible = includeDisconnected ? hosts : connected;
  if (!alwaysShow && connected.length <= 1) return null;
  if (visible.length === 0) return null;
  const selected = value && visible.some((host) => host.id === value)
    ? value
    : (visible.find((host) => host.status === 'connected') ?? visible[0])!.id;
  return (
    <PopoverPicklist
      value={selected}
      ariaLabel={ariaLabel}
      searchable={false}
      onChange={onChange}
      options={visible.map((host) => ({
        value: host.id,
        label: hostPickerLabel(host),
        description: hostPickerDescription(host),
        tone: host.status === 'disconnected' ? 'warning' : 'default'
      }))}
    />
  );
}
