import { arrayMove } from '@dnd-kit/sortable';

export const PINNED_SIDEBAR_NAV_IDS = ['home', 'inbox'] as const;

/** Keep a saved order valid as optional features and extensions come and go. */
export function normalizeSidebarNavOrder(
  value: unknown,
  availableIds: readonly string[],
  pinnedIds: readonly string[] = PINNED_SIDEBAR_NAV_IDS
): string[] {
  const available = new Set(availableIds);
  const pinned = pinnedIds.filter((id) => available.has(id));
  const pinnedSet = new Set(pinned);
  const seen = new Set<string>();
  const order: string[] = [...pinned];
  for (const id of pinned) seen.add(id);
  if (Array.isArray(value)) {
    for (const id of value) {
      if (
        typeof id !== 'string' ||
        !available.has(id) ||
        pinnedSet.has(id) ||
        seen.has(id)
      ) {
        continue;
      }
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of availableIds) {
    if (!seen.has(id)) order.push(id);
  }
  return order;
}

export function reorderSidebarNavItems(
  order: readonly string[],
  activeId: string,
  overId: string,
  pinnedIds: readonly string[] = PINNED_SIDEBAR_NAV_IDS
): string[] {
  const pinned = new Set(pinnedIds);
  if (pinned.has(activeId) || pinned.has(overId)) return [...order];
  const from = order.indexOf(activeId);
  const to = order.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...order];
  return arrayMove([...order], from, to);
}
