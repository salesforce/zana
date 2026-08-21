import { cloneElement, useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactElement } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { normalizeSidebarNavOrder, reorderSidebarNavItems } from './sidebarNavOrder.js';

export const AGENTS_SECTION_SORT_ID = 'sidebar-section:agents';
export const WORKSPACES_SECTION_SORT_ID = 'sidebar-section:workspaces';
export const GLOBAL_NAV_ORDER_KEY = 'zcc.sidebarNavOrder';
export const PROJECT_NAV_ORDER_KEY = 'zcc.projectSidebarNavOrder';
export const PINNED_PROJECT_NAV_IDS = ['inbox'] as const;

export function SortableNavItem({
  id,
  children
}: {
  id: string;
  children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`sidebar-nav-sortable ${isDragging ? 'is-dragging' : ''}`}
      data-sortable-nav-id={id}
      // The sidebar mixes compact rows with tall collection sections. Preserve a
      // dragged item's own dimensions instead of scaling it to the target's rect.
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {cloneElement(children, { ...attributes, ...listeners })}
    </div>
  );
}

export function SortableSidebarSection({
  id,
  children
}: {
  id: string;
  children: ReactElement<{ dragHandle?: HTMLAttributes<HTMLElement> }>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`sidebar-section-sortable ${isDragging ? 'is-dragging' : ''}`}
      data-sortable-sidebar-section-id={id}
      // See SortableNavItem: a section must translate between slots, not stretch
      // to the height of a nav row while it crosses one.
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {cloneElement(children, { dragHandle: { ...attributes, ...listeners } })}
    </div>
  );
}

const navCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

function readStoredNavOrder(key: string): unknown {
  if (typeof localStorage === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** Shared drag-and-drop order for the global Sidebar and the project rail. */
export function useSortableSidebarNav(
  storageKey: string,
  availableIds: readonly string[],
  pinnedIds: readonly string[]
) {
  const [storedNavOrder, setStoredNavOrder] = useState(() => readStoredNavOrder(storageKey));
  const suppressNavClickRef = useRef(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      try {
        setStoredNavOrder(JSON.parse(event.newValue ?? 'null'));
      } catch {
        setStoredNavOrder(null);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const orderedNavIds = normalizeSidebarNavOrder(storedNavOrder, availableIds, pinnedIds);
  const pinnedSet = new Set(pinnedIds);
  const pinnedNavIds = orderedNavIds.filter((id) => pinnedSet.has(id));
  const sortableNavIds = orderedNavIds.filter((id) => !pinnedSet.has(id));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    window.setTimeout(() => {
      suppressNavClickRef.current = false;
    }, 0);
    if (!over || active.id === over.id) return;
    const next = reorderSidebarNavItems(
      orderedNavIds,
      String(active.id),
      String(over.id),
      pinnedIds
    );
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(next));
    }
    setStoredNavOrder(next);
  };

  const onDragStart = ({ activatorEvent }: DragStartEvent) => {
    suppressNavClickRef.current = activatorEvent.type === 'pointerdown';
  };

  const onDragCancel = () => {
    window.setTimeout(() => {
      suppressNavClickRef.current = false;
    }, 0);
  };

  const consumeNavClick = () => {
    if (!suppressNavClickRef.current) return false;
    suppressNavClickRef.current = false;
    return true;
  };

  return {
    pinnedNavIds,
    sortableNavIds,
    sensors,
    collisionDetection: navCollisionDetection,
    onDragStart,
    onDragCancel,
    onDragEnd,
    consumeNavClick
  };
}
