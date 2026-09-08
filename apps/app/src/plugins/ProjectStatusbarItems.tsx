import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import type {
  PluginProjectStatusbarAlign,
  PluginProjectStatusbarItemRegistration,
  PluginProjectStatusbarMenuItem
} from '@zana-ai/zcc-plugin-sdk';
import { Modal } from '../components/Modal.js';
import { placePopoverMenu, useExclusivePopover } from '../components/ui/PopoverPicklist.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { invokePluginSlotRun } from './plugin-agent-actions.js';
import { projectStatusbarItemContext } from './plugin-nav-href.js';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import { listProjectStatusbarItems, subscribePluginSlots } from './plugin-slots.js';

const MENU_MIN_WIDTH = 160;

export function sortProjectStatusbarItems(
  items: readonly PluginProjectStatusbarItemRegistration[],
  align: PluginProjectStatusbarAlign
): PluginProjectStatusbarItemRegistration[] {
  return items
    .filter((item) => (item.align ?? 'right') === align)
    .slice()
    .sort((a, b) => {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      const plugin = a.pluginId.localeCompare(b.pluginId);
      if (plugin !== 0) return plugin;
      return a.id.localeCompare(b.id);
    });
}

export function ProjectStatusbarItems({
  projectId,
  align,
  navigate
}: {
  projectId: string;
  align: PluginProjectStatusbarAlign;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}): ReactNode {
  const items = useSyncExternalStore(
    subscribePluginSlots,
    listProjectStatusbarItems,
    listProjectStatusbarItems
  );
  const visible = sortProjectStatusbarItems(items, align);
  if (visible.length === 0) return null;
  return (
    <span
      className={`statusbar-plugin-group statusbar-plugin-group--${align}`}
      data-testid={`project-statusbar-${align}`}
    >
      {visible.map((slot) => (
        <ProjectStatusbarChip
          key={`${slot.pluginId}:${slot.id}:${slot.generation}`}
          slot={slot}
          projectId={projectId}
          navigate={navigate}
        />
      ))}
    </span>
  );
}

function ProjectStatusbarChip({
  slot,
  projectId,
  navigate
}: {
  slot: PluginProjectStatusbarItemRegistration;
  projectId: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}): ReactNode {
  const rootRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useExclusivePopover();
  const [menuItems, setMenuItems] = useState<readonly PluginProjectStatusbarMenuItem[]>([]);
  const [dialog, setDialog] = useState<{ title: string; params: JsonValue | null } | null>(null);

  const ctx = useMemo(
    () =>
      projectStatusbarItemContext(slot.pluginId, {
        projectId,
        navigate,
        openDialog(options) {
          if (!slot.component) return false;
          setDialog({
            title: options?.title ?? slot.label ?? slot.tooltip ?? slot.id,
            params: options?.params ?? null
          });
          return true;
        },
        openMenu(items) {
          if (items.length === 0) return false;
          setMenuItems(items);
          setMenuOpen(true);
          return true;
        }
      }),
    [navigate, projectId, setMenuOpen, slot]
  );

  useEffect(() => {
    if (!menuOpen || !rootRef.current || !menuRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const position = placePopoverMenu(
      rect,
      { width: window.innerWidth, height: window.innerHeight },
      MENU_MIN_WIDTH
    );
    const menu = menuRef.current;
    menu.style.left = `${position.left}px`;
    menu.style.width = `${Math.max(position.width, MENU_MIN_WIDTH)}px`;
    menu.style.maxHeight = `${position.maxHeight}px`;
    if (position.bottom != null) {
      menu.style.bottom = `${position.bottom}px`;
      menu.style.top = 'auto';
    } else {
      menu.style.top = `${position.top}px`;
      menu.style.bottom = 'auto';
    }
  }, [menuOpen, menuItems.length]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [menuOpen, setMenuOpen]);

  const dialogHelpers = {
    toProject: ctx.toProject,
    toPluginPanel: ctx.toPluginPanel
  };

  const chip = slot.item ? (
    <PluginSlotBoundary pluginId={slot.pluginId} generation={slot.generation}>
      {(() => {
        const Item = slot.item;
        return <Item pluginId={slot.pluginId} {...ctx} />;
      })()}
    </PluginSlotBoundary>
  ) : (
    <HostStatusbarChip slot={slot} onActivate={() => invokeStatusbarRun(slot, ctx)} />
  );

  const DialogBody = slot.component;

  return (
    <>
      <span
        ref={rootRef}
        className="statusbar-plugin-item"
        data-testid={`project-statusbar-item-${slot.pluginId}-${slot.id}`}
      >
        {chip}
      </span>
      {menuOpen
        ? createPortal(
            <div
              ref={menuRef}
              className="project-menu statusbar-menu"
              role="menu"
              data-testid={`project-statusbar-menu-${slot.pluginId}-${slot.id}`}
            >
              {menuItems.map((item) => {
                const Icon = item.icon ? resolveIcon(item.icon) : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="project-menu-item"
                    disabled={item.disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      invokePluginSlotRun(slot.pluginId, `${slot.id}:${item.id}`, 'projectStatusbarItem.menu', () =>
                        item.run()
                      );
                    }}
                  >
                    {Icon ? <Icon size={12} aria-hidden="true" /> : null}
                    {item.label}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
      {dialog && DialogBody ? (
        <Modal
          title={dialog.title}
          onClose={() => setDialog(null)}
          className="plugin-project-statusbar-modal"
        >
          <DialogBody
            pluginId={slot.pluginId}
            projectId={projectId}
            params={dialog.params}
            close={() => setDialog(null)}
            {...dialogHelpers}
          />
        </Modal>
      ) : null}
    </>
  );
}

function HostStatusbarChip({
  slot,
  onActivate
}: {
  slot: PluginProjectStatusbarItemRegistration;
  onActivate: () => void;
}): ReactNode {
  const Icon = slot.icon ? resolveIcon(slot.icon) : null;
  const label = slot.label ?? slot.id;
  const clickable = typeof slot.run === 'function';
  const inner = (
    <>
      {Icon ? <Icon size={11} aria-hidden="true" /> : null}
      <span>{label}</span>
    </>
  );
  if (!clickable) {
    return (
      <span className="statusbar-item" title={slot.tooltip ?? label}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="statusbar-item"
      title={slot.tooltip ?? label}
      aria-label={slot.tooltip ?? label}
      onClick={onActivate}
    >
      {inner}
    </button>
  );
}

function invokeStatusbarRun(
  slot: PluginProjectStatusbarItemRegistration,
  ctx: ReturnType<typeof projectStatusbarItemContext>
): void {
  if (!slot.run) return;
  invokePluginSlotRun(slot.pluginId, slot.id, 'projectStatusbarItem', () => slot.run!(ctx));
}
