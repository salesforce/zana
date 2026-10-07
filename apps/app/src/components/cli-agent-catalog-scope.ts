import type { Project } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { defaultHostId } from '../hooks/useHosts.js';

/** The registered project owns discovery; the primary machine owns the SSH PTY. */
export function cliAgentCatalogScope(project: Project | undefined, hosts: Host[]) {
  const ready = !project?.remote || Boolean(project.hostId
    && hosts.some(host => host.id === project.hostId && host.status === 'connected'));
  return {
    hostId: defaultHostId(hosts, project),
    executionHostId: defaultHostId(hosts),
    projectId: project?.id,
    ready
  };
}
