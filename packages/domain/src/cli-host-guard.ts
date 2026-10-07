import type { CreateTerminalRequest, Project } from './product.js';

/** Authorize against the registered project, never a caller-supplied SSH target.
 * SSH projects use the primary coordinator's existing remote PTY backend;
 * machine-owned checkouts without SSH metadata still require a Modern thread. */
export function cliHostProblem(
  request: Pick<CreateTerminalRequest, 'hostId'>,
  project: Pick<Project, 'hostId' | 'remote'> | undefined,
  localHostId?: string
): string | undefined {
  const requested = request.hostId;
  if (requested !== undefined && (typeof requested !== 'string' || !requested)) return 'Choose a valid execution machine.';
  const sshProject = Boolean(project?.remote);
  const requestedHostSupported = !requested || requested === localHostId
    || (sshProject && requested === project?.hostId);
  if (!requestedHostSupported || (!sshProject && project?.hostId && project.hostId !== localHostId)) {
    return 'CLI Agents on secondary machines are not available yet. Use a Modern thread on that machine.';
  }
  return undefined;
}
