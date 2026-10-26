import type { Project } from '@zana-ai/zcc-domain/product';
import { apiJson } from './fetch-with-app-surface.js';

export type ProjectAvailability = 'ready' | 'missing' | 'inaccessible' | 'not-directory' | 'offline' | 'unknown';
export const projectAvailabilityLabel: Record<ProjectAvailability, string> = {
  ready: '', missing: 'Folder missing', inaccessible: 'Cannot access folder',
  'not-directory': 'Folder replaced by a file', offline: 'Machine offline', unknown: 'Folder status unavailable'
};
export async function readProjectAvailability(projectIds: string[]): Promise<Record<string, ProjectAvailability>> {
  const statuses: Record<string, ProjectAvailability> = {};
  for (let offset = 0; offset < projectIds.length; offset += 100) {
    const result = await apiJson<{ statuses: Record<string, ProjectAvailability> }>('/projects/availability', {
      method: 'POST', body: JSON.stringify({ projectIds: projectIds.slice(offset, offset + 100) })
    });
    Object.assign(statuses, result.statuses);
  }
  return statuses;
}
export async function createProjectFolder(input: { hostId: string; parentPath: string; name: string; operationId: string }): Promise<Project> {
  return (await apiJson<{ project: Project }>('/projects/create-folder', { method: 'POST', body: JSON.stringify(input) })).project;
}
