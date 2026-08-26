import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';

export function HostMachinePicker({
  hosts,
  value,
  onChange,
  ariaLabel = 'Machine'
}: {
  hosts: Host[];
  value?: string;
  onChange: (hostId: string) => void;
  ariaLabel?: string;
}) {
  const connected = hosts.filter((host) => host.status === 'connected');
  if (connected.length <= 1) return null;
  return (
    <PopoverPicklist
      value={value ?? connected[0]!.id}
      ariaLabel={ariaLabel}
      searchable={false}
      onChange={onChange}
      options={connected.map((host) => ({
        value: host.id,
        label: host.isPrimary ? `${host.name} (this machine)` : host.name
      }))}
    />
  );
}
