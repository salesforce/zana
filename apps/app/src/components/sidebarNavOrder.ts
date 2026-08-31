import { arrayMove } from '@dnd-kit/sortable';

export const PINNED_SIDEBAR_NAV_IDS = ['home', 'inbox'] as const;

/** Retired collapsible collection; saved orders map this onto the Agents row. */
export const LEGACY_AGENTS_SECTION_ID = 'sidebar-section:agents';

function canonicalizeSidebarNavId(id: string, available: Set<string>): string {
  if (id === LEGACY_AGENTS_SECTION_ID && available.has('agents')) return 'agents';
  return id;
}

/** Keep a saved order valid as optional features and extensions come and go.
 *  Unseen ids insert before the next already-placed neighbor from `availableIds`
 *  so a new plugin rail lands above Workspaces, not under it.
 */
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
    for (const raw of value) {
      if (typeof raw !== 'string') continue;
      const id = canonicalizeSidebarNavId(raw, available);
      if (!available.has(id) || pinnedSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
  }
  for (const id of availableIds) {
    if (seen.has(id)) continue;
    const at = availableIds.indexOf(id);
    const nextKnown = availableIds.slice(at + 1).find((candidate) => seen.has(candidate));
    if (nextKnown) {
      order.splice(order.indexOf(nextKnown), 0, id);
    } else {
      order.push(id);
    }
    seen.add(id);
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
