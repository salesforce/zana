import { applyListPaneWidth, LIST_PANE_MIN, LIST_PANE_MAX } from '../store';

/**
 * The drag handle that resizes the list column (column 2). Straddles the shared
 * border with the workspace via CSS (`right: -5px`), so it must be rendered
 * INSIDE a `.list-pane` section to anchor against its right edge.
 *
 * Previously this lived only in the Projects list, so every other rail (Agents,
 * Scheduler, Settings, Inbox, Skills/MCP/Plugins, the project Focus view)
 * couldn't be resized. It's now a shared component dropped into each pane so the
 * list column resizes uniformly everywhere it appears.
 *
 * Width state is global: the drag writes `--col-list` live (clamped) and
 * persists the final value to AppConfig on mouse-up; double-click resets to the
 * 280px default. All panes read the same `--col-list`, so resizing in one rail
 * carries to the others.
 */
export function ListPaneResizer() {
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing-col');
    const onMove = (ev: MouseEvent) => {
      // Pane sits to the right of the nav column; its left edge equals --col-nav.
      const navW = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--col-nav')
      );
      const next = ev.clientX - (Number.isFinite(navW) ? navW : 0);
      applyListPaneWidth(next);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-col');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const w = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--col-list')
      );
      if (Number.isFinite(w)) {
        window.cc.config.set({ listPaneWidth: Math.round(w) }).catch(() => {});
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onResizeDoubleClick = () => {
    applyListPaneWidth(280);
    window.cc.config.set({ listPaneWidth: 280 }).catch(() => {});
  };

  return (
    <div
      className="list-pane-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={LIST_PANE_MIN}
      aria-valuemax={LIST_PANE_MAX}
      title="Drag to resize · double-click to reset"
      onMouseDown={onResizeMouseDown}
      onDoubleClick={onResizeDoubleClick}
    />
  );
}
