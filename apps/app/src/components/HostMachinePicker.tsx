import { Laptop, Monitor } from 'lucide-react';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project } from '@zana-ai/zcc-domain/product';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { hostPickerDescription, hostPickerLabel } from './composer-host-status.js';

export function HostMachinePicker({
  hosts,
  value,
  onChange,
  ariaLabel = 'Machine',
  includeDisconnected = false,
  alwaysShow = false,
  project
}: {
  hosts: Host[];
  value?: string;
  onChange: (hostId: string) => void;
  ariaLabel?: string;
  includeDisconnected?: boolean;
  alwaysShow?: boolean;
  project?: Project;
}) {
  const connected = hosts.filter((host) => host.status === 'connected');
  const visible = includeDisconnected ? hosts : connected;
  if (!alwaysShow && connected.length <= 1) return null;
  if (visible.length === 0) return null;
  const selected = value && visible.some((host) => host.id === value)
    ? value
    : (visible.find((host) => host.status === 'connected') ?? visible[0])!.id;
  const selectedHost = visible.find((host) => host.id === selected);
  return (
    <PopoverPicklist
      value={selected}
      ariaLabel={ariaLabel}
      searchable={visible.length > 5}
      minWidth={280}
      title={selectedHost?.name}
      onChange={onChange}
      options={visible.map((host) => ({
        value: host.id,
        label: hostPickerLabel(host, project),
        description: hostPickerDescription(host, project),
        tone: host.status === 'disconnected' ? 'warning' : 'default',
        content: (
          <span className="host-machine-picker-option">
            {host.isPrimary ? <Laptop size={14} aria-hidden="true" /> : <Monitor size={14} aria-hidden="true" />}
            {hostPickerLabel(host, project)}
          </span>
        )
      }))}
    />
  );
}
