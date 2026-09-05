import {
  cloneElement,
  Fragment,
  useSyncExternalStore,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode
} from 'react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Link } from 'react-router-dom';
import { Bug, Settings } from 'lucide-react';
import { openBugReport } from '../lib/report-bug.js';
import { useUi } from '../store.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { useAppSettingsRouteMemory } from '../hooks/useAppSettingsRouteMemory.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { listSidebarFooterActions, subscribePluginSlots } from '../plugins/plugin-slots.js';
import { getPluginDetailRoutePath } from '../lib/route-paths.js';
import { appNavigate } from '../lib/app-navigate.js';
import { SidebarResizer } from './SidebarResizer.js';
import {
  SortableNavItem,
  SortableSidebarSection,
  useSortableSidebarNav
} from './sidebarSortable.js';
import { usePaneContentSplitDrag } from './sidebar/useThreadRowSplitDrag.js';
import { usePaneContentSplitIndicator } from './sidebar/paneContentSplitIndicator.js';
import { SplitPaneMiniMap } from './sidebar/SplitPaneMiniMap.js';
import type { PaneContent } from '../lib/split-layout/types.js';

export interface SidebarRailRow {
  kind: 'row';
  id: string;
  label: string;
  icon: ReactNode;
  to: string;
  testId: string;
  active: boolean;
  title?: string;
  badge?: ReactNode;
  running?: boolean;
  onClick?: (event: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => void;
  /** When set, cmd-click and drag-to-edge open this content in the split workspace. */
  splitContent?: PaneContent;
}

export interface SidebarRailSection {
  kind: 'section';
  id: string;
  node: ReactElement;
}

export type SidebarRailItem = SidebarRailRow | SidebarRailSection;

/**
 * Shared sortable rail chrome for the global Sidebar and the project rail.
 * Catalogs pass destinations; this component owns drag-and-drop, the
 * Settings/plugin utility dock, and the column resizer. Back/forward live on
 * the persistent title-bar overlay so they survive rail collapse.
 */
export function SidebarRail({
  className,
  navAriaLabel,
  storageKey,
  pinnedIds,
  trailingIds = [],
  items,
  header,
  utilityStart
}: {
  className: string;
  navAriaLabel: string;
  storageKey: string;
  pinnedIds: readonly string[];
  trailingIds?: readonly string[];
  items: readonly SidebarRailItem[];
  header?: ReactNode;
  utilityStart?: ReactNode;
}): ReactElement {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const { nav } = useRouteState();
  const routeMemory = useAppSettingsRouteMemory();
  const footerActions = useSyncExternalStore(
    subscribePluginSlots,
    listSidebarFooterActions,
    listSidebarFooterActions
  );
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const {
    pinnedNavIds,
    sortableNavIds,
    trailingNavIds,
    sensors,
    collisionDetection,
    onDragStart,
    onDragCancel,
    onDragEnd,
    consumeNavClick
  } = useSortableSidebarNav(
    storageKey,
    items.map((item) => item.id),
    pinnedIds,
    trailingIds
  );

  const onNavigate = (event: { preventDefault: () => void }) => {
    if (consumeNavClick()) event.preventDefault();
  };

  const renderItem = (id: string, sortable: boolean) => {
    const item = itemsById.get(id);
    if (!item) return null;
    if (item.kind === 'section') {
      const section = cloneElement(
        item.node as ReactElement<{
          dragHandle?: HTMLAttributes<HTMLElement>;
          onNavigate?: (event: { preventDefault: () => void }) => void;
        }>,
        { onNavigate }
      );
      if (!sortable) {
        return (
          <div key={id} className="sidebar-section-sortable">
            {section}
          </div>
        );
      }
      return (
        <SortableSidebarSection key={id} id={id}>
          {section}
        </SortableSidebarSection>
      );
    }
    const row = item.splitContent ? (
      <SplitEnabledNavRow
        item={item}
        collapsed={collapsed}
        consumeNavClick={consumeNavClick}
      />
    ) : (
      <SidebarNavRow
        label={item.label}
        icon={item.icon}
        active={item.active}
        collapsed={collapsed}
        title={item.title}
        testId={item.testId}
        badge={item.badge}
        running={item.running}
        to={item.to}
        onClick={(event) => {
          if (consumeNavClick()) {
            event.preventDefault();
            return;
          }
          item.onClick?.(event);
        }}
      />
    );
    if (!sortable) return <Fragment key={id}>{row}</Fragment>;
    return (
      <SortableNavItem key={id} id={id}>
        {row}
      </SortableNavItem>
    );
  };

  return (
    <aside className={className}>
      {header}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
      >
        <div className="sidebar-sections">
          <nav
            className="sidebar-nav sidebar-nav--sortable"
            aria-label={navAriaLabel}
            data-testid="sidebar-navigation"
          >
            {pinnedNavIds.map((id) => renderItem(id, false))}
            <SortableContext items={sortableNavIds} strategy={verticalListSortingStrategy}>
              {sortableNavIds.map((id) => renderItem(id, true))}
            </SortableContext>
            {trailingNavIds.map((id) => renderItem(id, false))}
          </nav>
        </div>
      </DndContext>
      <div className="sidebar-utility-bar" aria-label="Sidebar utilities">
        {utilityStart}
        <Link
          to={routeMemory.settingsRoutePath}
          className={`sidebar-utility-button ${nav === 'settings' ? 'active' : ''}`}
          aria-label="Settings"
          aria-current={nav === 'settings' ? 'page' : undefined}
          title="Settings"
        >
          <Settings size={18} />
        </Link>
        <button
          type="button"
          className="sidebar-utility-button"
          aria-label="Report a bug"
          title="Report a bug"
          onClick={() => openBugReport()}
        >
          <Bug size={18} aria-hidden="true" />
        </button>
        {footerActions.map((action) => {
          const Icon = resolveIcon(action.icon);
          return (
            <button
              key={`${action.id}:${action.generation}`}
              type="button"
              className="sidebar-utility-button"
              aria-label={action.title}
              title={action.title}
              onClick={() => {
                void action.run({
                  openSettings() {
                    appNavigate(getPluginDetailRoutePath(action.pluginId));
                  }
                });
              }}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>
      <SidebarResizer />
    </aside>
  );
}

/** Must forward extra props — SortableNavItem cloneElement's dnd-kit
 *  listeners onto this component, not onto a host <a>. */
function SplitEnabledNavRow({
  item,
  collapsed,
  consumeNavClick,
  onPointerDown,
  ...sortableRest
}: {
  item: SidebarRailRow;
  collapsed: boolean;
  consumeNavClick: () => boolean;
} & Omit<HTMLAttributes<HTMLAnchorElement>, 'onClick' | 'children' | 'title'>) {
  const splitContent = item.splitContent;
  const { onPointerDown: onSplitPointerDown, openInSplit } = usePaneContentSplitDrag({
    content: splitContent ?? { kind: 'home' },
    title: item.label
  });
  const indicator = usePaneContentSplitIndicator(splitContent ?? { kind: 'home' }, splitContent !== undefined);
  return (
    <SidebarNavRow
      {...sortableRest}
      label={item.label}
      icon={item.icon}
      active={item.active}
      collapsed={collapsed}
      title={item.title}
      testId={item.testId}
      badge={item.badge}
      running={item.running}
      to={item.to}
      accessory={
        indicator.miniMap ? (
          <SplitPaneMiniMap slots={indicator.miniMap} label={`${item.label} split layout`} />
        ) : undefined
      }
      onPointerDown={onPointerDown}
      onSplitPointerDown={splitContent ? onSplitPointerDown : undefined}
      onClick={(event) => {
        if (consumeNavClick()) {
          event.preventDefault();
          return;
        }
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          openInSplit();
          return;
        }
        item.onClick?.(event);
      }}
    />
  );
}

function SidebarNavRow({
  label,
  icon,
  active,
  collapsed,
  title,
  testId,
  badge,
  running,
  to,
  accessory,
  onClick,
  onPointerDown,
  onSplitPointerDown,
  ...rest
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  collapsed: boolean;
  title?: string;
  testId?: string;
  badge?: ReactNode;
  running?: boolean;
  to: string;
  accessory?: ReactNode;
  onClick?: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLAnchorElement>) => void;
  onSplitPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
} & Omit<
  HTMLAttributes<HTMLAnchorElement>,
  'onClick' | 'onPointerDown' | 'children' | 'title'
>): ReactElement {
  return (
    <Link
      to={to}
      {...rest}
      data-testid={testId}
      className={`nav-item ${active ? 'active' : ''}`}
      onClick={onClick}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        onSplitPointerDown?.(event);
      }}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      title={title ?? label}
    >
      <span className="nav-item-icon">
        {icon}
        {running && <span className="nav-running-dot" aria-hidden="true" />}
      </span>
      <span className="nav-item-label">{label}</span>
      {badge}
      {accessory}
    </Link>
  );
}

export function SidebarCountBadge({
  count,
  label,
  title,
  kind
}: {
  count: number;
  label: string;
  title: string;
  kind?: 'running' | 'blocked';
}): ReactElement {
  return (
    <span
      className={`nav-badge${kind ? ` nav-badge--${kind}` : ''}`}
      aria-label={label}
      title={title}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
