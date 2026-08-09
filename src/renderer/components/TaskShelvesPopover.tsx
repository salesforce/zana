import { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import type { Shelf, ShelfRow } from '@shared/types';
import { resolveIcon } from '../util/resolveIcon';

/**
 * Task Shelves popover (afl-04) — a compact, host-owned ledger pinned to the
 * agent modal header. A glyph button (total-row-count badge) toggles an anchored
 * popover with the three fixed shelves (Sources / Background / Outputs), each a
 * list of host-rendered rows. Mirrors CatchUpSummaryCard's popover mechanics
 * (role="dialog", outside-click + Escape dismiss).
 *
 * Generic + core (Rule 6): rows are structured data; icons resolve by NAME via
 * resolveIcon, never a component reference. The row-click handler is supplied by
 * the caller (renderer-side), keeping buildShelves pure.
 */
export function TaskShelvesPopover({
  shelves,
  onSelectRow
}: {
  shelves: Shelf[];
  onSelectRow?: (row: ShelfRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const total = shelves.reduce((n, s) => n + s.rows.length, 0);
  const title = `Task shelves — ${total} item${total === 1 ? '' : 's'}`;

  return (
    <div className="task-shelf" ref={rootRef}>
      <button
        type="button"
        className={`task-shelf-icon ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-label={title}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Layers size={14} />
        {total > 0 && <span className="task-shelf-badge">{total > 99 ? '99+' : total}</span>}
      </button>

      {open && (
        <div className="task-shelf-pop" role="dialog" aria-label="Task shelves">
          {shelves.map((shelf) => (
            <section key={shelf.id} className="task-shelf-section">
              <h4 className="task-shelf-label">{shelf.label}</h4>
              {shelf.rows.length === 0 ? (
                <p className="task-shelf-empty">Nothing here.</p>
              ) : (
                <ul className="task-shelf-rows">
                  {shelf.rows.map((row) => (
                    <TaskShelfRow key={row.id} row={row} onSelect={onSelectRow} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskShelfRow({
  row,
  onSelect
}: {
  row: ShelfRow;
  onSelect?: (row: ShelfRow) => void;
}) {
  const Icon = row.icon ? resolveIcon(row.icon) : null;
  return (
    <li className={`task-shelf-row tone-${row.tone ?? 'default'}`}>
      <button
        type="button"
        className="task-shelf-row-btn"
        onClick={() => onSelect?.(row)}
        disabled={!onSelect}
      >
        {row.status && <span className={`task-shelf-dot status-${row.status}`} aria-hidden />}
        {Icon && <Icon size={12} aria-hidden />}
        <span className="task-shelf-row-title">{row.title}</span>
        {row.meta && <span className="task-shelf-row-meta">{row.meta}</span>}
        {row.detail && <span className="task-shelf-row-detail">{row.detail}</span>}
      </button>
    </li>
  );
}
