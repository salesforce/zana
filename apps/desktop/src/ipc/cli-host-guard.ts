import type { Project } from '@zana-ai/zcc-domain/product';
export { cliHostProblem } from '@zana-ai/zcc-domain/cli-host-guard';

/** Team workers use the primary CLI coordinator. Check before inspecting source
 * files or reserving an execution, including calls made by a Modern owner. */
export function teamHostProblem(project: Pick<Project, 'hostId'>, localHostId?: string): string | undefined {
  if (project.hostId && project.hostId !== localHostId) {
    return 'Squad/Team execution on secondary machines is not available yet. Choose a project on the primary machine.';
  }
  return undefined;
}
