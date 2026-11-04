import type { Project } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { primaryMachineLabel } from './machine-projects.js';

/** A session's recorded execution host takes precedence over its project's owner. */
export function sessionLocation(
  hostId: string | null | undefined,
  project: Pick<Project, 'hostId' | 'remote'> | undefined,
  hosts: readonly Host[]
) {
  const primary = hosts.find(host => host.isPrimary);
  const executionHostId = hostId || project?.hostId || primary?.id;
  const host = hosts.find(row => row.id === executionHostId);
  const remoteToolProxy = Boolean(project?.remote && (!project.hostId || executionHostId !== project.hostId));
  return {
    hostId: executionHostId,
    machineName: host ? (host.isPrimary ? primaryMachineLabel() : host.name)
      : executionHostId ? 'Unavailable machine' : undefined,
    remote: host ? !host.isPrimary : Boolean(executionHostId && executionHostId !== primary?.id),
    remoteToolProxy
  };
}
