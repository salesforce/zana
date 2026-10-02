import type { Project } from '@zana-ai/zcc-domain/product';

export function resolveFocusedProject(
  focusedProjectId: string | null,
  projects: readonly Project[]
): Project | undefined {
  return focusedProjectId
    ? projects.find((project) => project.id === focusedProjectId)
    : undefined;
}
