import { arrayMove } from '@dnd-kit/sortable';

/** Reorder only the projects visible in one section while retaining every other
 * persisted project position. Session ids never enter this calculation. */
export function reorderProjectIds(
  orderedIds: string[],
  groupIds: string[],
  fromId: string,
  toId: string
): string[] {
  const fromIndex = groupIds.indexOf(fromId);
  const toIndex = groupIds.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return orderedIds;
  const nextGroupIds = arrayMove(groupIds, fromIndex, toIndex);
  const groupSet = new Set(nextGroupIds);
  let nextGroupIndex = 0;
  return orderedIds.map((id) => (groupSet.has(id) ? nextGroupIds[nextGroupIndex++] : id));
}
