/**
 * The tile's bottom project-association ROW (tile redesign item 5;
 * R-LIST-020 / AC-LIST-20.1/20.2).
 *
 * This IS the tile's bottom row — it replaces both the old right-side icon
 * button and the old gray "project line". It is ALWAYS present:
 *  - associated   → folder icon + the Project name (primary text)
 *  - unassociated → folder icon + "Not associated with a project" (muted)
 *
 * Both the icon and the label are one clickable affordance that opens the
 * picker (set / change / clear the associated Project — R-INBOX-001). The
 * unassociated state's meaning ("inbox notifications disabled") is carried in
 * the hover text AND the accessible name (AC-LIST-20.2a) — never by hue alone.
 *
 * `stopPropagation` on activation keeps a project click from also marking the
 * tile seen. The picker is portaled to `document.body` (escapes overflow-clipped
 * / transformed ancestors), same as {@link SyncFilterMenu}.
 */

import { useEffect, useRef, useState } from 'react';
import { FolderGit2 } from 'lucide-react';
import type { ProjectInfo } from './host.js';
import { portal } from './portal.js';

interface PickerPosition {
  left: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

const MENU_GAP = 4;
const VIEWPORT_GUTTER = 8;
const MENU_MIN_HEIGHT = 120;
const MENU_MAX_HEIGHT = 320;
const MENU_MAX_WIDTH = 280;

/** Keep the portaled picker within the viewport, preferring the roomier side. */
export function positionProjectPicker(
  rect: Pick<DOMRect, 'top' | 'bottom' | 'left'>,
  viewport: Pick<Window, 'innerWidth' | 'innerHeight'>
): PickerPosition {
  const below = viewport.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_GUTTER;
  const above = rect.top - MENU_GAP - VIEWPORT_GUTTER;
  const openAbove = below < MENU_MIN_HEIGHT && above > below;
  const maxHeight = Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, openAbove ? above : below));
  const left = Math.max(VIEWPORT_GUTTER, Math.min(rect.left, viewport.innerWidth - MENU_MAX_WIDTH - VIEWPORT_GUTTER));

  return openAbove
    ? { left, bottom: viewport.innerHeight - rect.top + MENU_GAP, maxHeight }
    : { left, top: rect.bottom + MENU_GAP, maxHeight };
}

interface Props {
  projectId?: string;
  projects: ProjectInfo[];
  onAssign: (projectId: string | null) => void;
}

export function PrProjectControl({ projectId, projects, onAssign }: Props) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PickerPosition | null>(null);

  const assigned = projects.find((p) => p.id === projectId);
  const associated = Boolean(assigned);

  useEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    setPos(positionProjectPicker(el.getBoundingClientRect(), window));
  }, [open]);

  useEffect(() => {
    if (!open || !pos) return;
    const menu = menuRef.current;
    (menu?.querySelector<HTMLButtonElement>('.is-active') ?? menu?.querySelector('button') ?? menu)?.focus();
  }, [open, pos]);

  const closeMenu = () => {
    setOpen(false);
    anchorRef.current?.focus();
  };

  // Hover text + accessible name: state + what activating does; red state states
  // "inbox notifications disabled" explicitly (AC-LIST-20.2a / AC-LIST-20.5).
  const title = associated
    ? `Associated with ${assigned!.name} — change or clear the Project`
    : 'Not associated with a project — inbox notifications disabled. Click to associate a Project.';

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`prm-project-row ${associated ? 'prm-project-row--associated' : 'prm-project-row--unassociated'}`}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <FolderGit2 size={11} className="prm-project-row-icon" aria-hidden />
        <span className="prm-project-row-name">
          {associated ? assigned!.name : 'Not associated with a project'}
        </span>
      </button>

      {open && pos && typeof document !== 'undefined' &&
        portal(
          <>
            <div
              className="prm-project-menu-backdrop"
              onClick={(e) => {
                e.stopPropagation();
                closeMenu();
              }}
            />
            <div
              ref={menuRef}
              className="prm-tile-menu prm-project-picker"
              style={{ position: 'fixed', ...pos }}
              role="menu"
              aria-label="Associate a project"
              tabIndex={-1}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || e.key === 'Tab') {
                  e.preventDefault();
                  e.stopPropagation();
                  closeMenu();
                } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                  e.preventDefault();
                  e.stopPropagation();
                  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
                  const index = items.indexOf(document.activeElement as HTMLButtonElement);
                  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
                    : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                  items[next]?.focus();
                }
              }}
            >
              {projects.length === 0 && <div className="prm-project-menu-empty">No projects</div>}
              {associated && (
                <button
                  type="button"
                  className="prm-project-menu-item"
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssign(null);
                    closeMenu();
                  }}
                >
                  Clear association
                </button>
              )}
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`prm-project-menu-item ${p.id === projectId ? 'is-active' : ''}`}
                  role="menuitem"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssign(p.id);
                    closeMenu();
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  );
}
