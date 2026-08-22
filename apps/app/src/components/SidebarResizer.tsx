import { applySidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX } from '../store.js';

/**
 * Drag handle that resizes the nav sidebar (`--col-nav`). Straddles the shared
 * border with the content track via CSS (`right: -12px` cancels `.sidebar`
 * padding so the hit target sits on the column edge).
 *
 * Width state is global: the drag writes `--col-nav` live (clamped) and
 * persists the final value to AppConfig on mouse-up; double-click resets to
 * the 256px default (also the minimum). Every rail — global Sidebar, project
 * focus, Settings, Extensions — occupies the same column, so each mounts this
 * handle and they all share one width.
 */
export function SidebarResizer() {
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing-col');
    const onMove = (ev: MouseEvent) => {
      applySidebarWidth(ev.clientX);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-col');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const w = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--col-nav')
      );
      if (Number.isFinite(w) && w > 0) {
        window.cc.config.set({ sidebarWidth: Math.round(w) }).catch(() => {});
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onResizeDoubleClick = () => {
    applySidebarWidth(SIDEBAR_MIN);
    window.cc.config.set({ sidebarWidth: SIDEBAR_MIN }).catch(() => {});
  };

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      title="Drag to resize · double-click to reset"
      onMouseDown={onResizeMouseDown}
      onDoubleClick={onResizeDoubleClick}
    />
  );
}
