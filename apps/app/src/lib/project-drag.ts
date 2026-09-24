/** Project identity only; the receiving composer resolves it against its project list. */
export const PROJECT_DRAG_MIME = 'application/x-zcc-project';

export function beginProjectDrag(
  dataTransfer: DataTransfer,
  project: { id: string; name: string }
): void {
  dataTransfer.setData(PROJECT_DRAG_MIME, project.id);
  dataTransfer.setData('text/plain', `@${project.name}`);
  dataTransfer.effectAllowed = 'copyMove';
}

export function projectFromDrag<T extends { id: string }>(
  dataTransfer: Pick<DataTransfer, 'getData'>,
  projects: readonly T[]
): T | undefined {
  const id = dataTransfer.getData(PROJECT_DRAG_MIME);
  return id ? projects.find((project) => project.id === id) : undefined;
}
