import { useMemo, useState } from 'react';
import { FolderPlus, Home, Laptop, Server } from 'lucide-react';
import type { Project } from '@zana-ai/zcc-domain/product';
import { useData } from '../store.js';
import { useHosts } from '../hooks/useHosts.js';
import { groupProjectsByMachine, locationValue, type ComposerLocation, type MachineProjectGroup } from '../lib/machine-projects.js';
import { AddMachineProjectDialog } from './AddMachineProjectDialog.js';
import { composerProjectLabel, isScratchWorkspaceProject } from './composer-project-default.js';
import './listpane/machine-projects.css';
import { DesktopProjectPicker, type DesktopProjectOption } from './DesktopProjectPicker.js';
import { MobileProjectPicker } from './MobileProjectPicker.js';
import { useCompactLayout } from '../hooks/useCompactLayout.js';

const ADD_PROJECT = 'add-machine-project';

/** One location control. Named checkouts keep their registered host; scratch tasks can use a daemon's personal environment. */
export function ComposerProjectPicker({
  projects, value, hostId, onChange, onHostChange, onStartNewThread, disabled, title
}: {
  projects: readonly Project[];
  value: string;
  hostId?: string;
  onChange: (projectId: string) => void;
  onHostChange?: (hostId: string | undefined) => void;
  /** Existing threads never change target. Selecting a location explicitly creates a new draft. */
  onStartNewThread?: (location: ComposerLocation) => void;
  disabled?: boolean;
  title?: string;
}) {
  const compact = useCompactLayout();
  const hosts = useHosts();
  const rememberLastProjectId = useData(s => s.rememberLastProjectId);
  const [adding, setAdding] = useState<MachineProjectGroup | null>(null);
  const groups = useMemo(() => groupProjectsByMachine(projects, hosts), [projects, hosts]);
  const project = projects.find(row => row.id === value);
  const group = groups.find(row => row.projects.some(p => p.id === value)
    && (!isScratchWorkspaceProject(project ?? { name: '' }) || row.hostId === hostId))
    ?? groups.find(row => row.projects.some(p => p.id === value)) ?? groups[0];
  const selectedValue = locationValue({ projectId: value, hostId: onStartNewThread ? hostId : group?.hostId });
  const choices = groups.flatMap(machine => machine.projects.filter(row =>
    machine.primary || !isScratchWorkspaceProject(row) || onHostChange || onStartNewThread || row.hostId === machine.hostId
  ).map(row => ({ project: row, group: machine, value: locationValue({ projectId: row.id, hostId: machine.hostId }) })));
  const choose = (location: ComposerLocation) => {
    if (onStartNewThread) { onStartNewThread(location); return; }
    rememberLastProjectId?.(location.projectId);
    // Set both explicit fields in the same React event; text/attachments retain their composer session.
    onHostChange?.(location.hostId);
    onChange(location.projectId);
  };
  const recordedHost = onStartNewThread ? hosts.find(host => host.id === hostId) : undefined;
  const recordedName = recordedHost ? groups.find(row => row.hostId === recordedHost.id)?.name ?? recordedHost.name : undefined;
  const pickerProps = {
    ariaLabel: onStartNewThread ? 'Thread location — start a new thread elsewhere' : 'Machine and project',
    value: selectedValue,
    placeholder: `${group?.name ?? 'Machine'} › ${project ? composerProjectLabel(project) : 'Default Project'}`,
    disabled,
    title: title ?? (onStartNewThread ? 'This thread keeps its location. Choose a location for a new thread.' : 'Choose where this thread starts'),
    triggerIcon: group?.primary ? <Laptop size={14} aria-hidden="true" /> : <Server size={14} aria-hidden="true" />,
    className: 'composer-location-picker',
    searchPlaceholder: 'Search machines or projects…',
    emptyHint: 'No matching machines or projects',
    options: [
      ...(onStartNewThread && project && !choices.some(choice => choice.value === selectedValue) ? [{
        value: selectedValue, label: `${recordedName ?? 'Unavailable machine'} › ${composerProjectLabel(project)}`,
        description: 'Current thread location', disabled: true, machineId: groups.find(row => row.hostId === hostId)?.id ?? group?.id
      }] : []),
      ...choices.map(choice => ({
        value: choice.value, machineId: choice.group.id, project: choice.project,
        label: `${choice.group.name} › ${composerProjectLabel(choice.project)}`,
        compactLabel: `${choice.group.name.length > 24 ? `${choice.group.name.slice(0, 23)}…` : choice.group.name} › ${composerProjectLabel(choice.project)}`,
        content: <span className="composer-project-picker-option"><span className={compact ? undefined : 'sr-only'}>{choice.group.name} › </span>{isScratchWorkspaceProject(choice.project) ? <Home size={14} aria-hidden="true" /> : null}{composerProjectLabel(choice.project)}</span>,
        description: onStartNewThread
          ? `New thread on ${choice.group.name}${choice.group.host?.status === 'disconnected' ? ' · Offline' : ''}`
          : isScratchWorkspaceProject(choice.project) ? `General tasks on ${choice.group.name}` : choice.project.remote?.remotePath ?? choice.project.path,
        group: `${choice.group.name} · ${choice.group.host?.status === 'connected' ? 'Online' : choice.group.host ? 'Offline' : choice.group.hostId ? 'Unavailable' : choice.group.remote ? 'Setup needed' : 'Local'}`
      })),
      ...(!onStartNewThread && group ? [{
        value: ADD_PROJECT,
        label: `Add project on ${group.name}`,
        content: <span className="composer-project-picker-option"><FolderPlus size={14} aria-hidden="true" />Add project on {group.name}</span>,
        sticky: true
      }] : [])
    ] satisfies DesktopProjectOption[],
    onChange: (next: string) => {
      if (next === ADD_PROJECT) { setAdding(group); return; }
      const choice = choices.find(row => row.value === next);
      if (choice) choose({ projectId: choice.project.id, hostId: choice.group.hostId });
    }
  };
  return <>
    {compact ? <MobileProjectPicker {...pickerProps} /> : <DesktopProjectPicker {...pickerProps}
      machines={groups} selectedMachineId={onStartNewThread ? groups.find(row => row.hostId === hostId)?.id ?? group?.id : group?.id}
      onAddProject={onStartNewThread ? undefined : setAdding} />}
    {adding && <AddMachineProjectDialog group={adding} onClose={() => setAdding(null)} onAdded={added => {
      choose({ projectId: added.id, hostId: adding.hostId });
      setAdding(null);
    }} />}
  </>;
}
