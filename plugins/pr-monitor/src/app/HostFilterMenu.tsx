/**
 * "Host" filter picker (R-LIST-027) — the toolbar dropdown that narrows the PR
 * list to one or more git hosts (e.g. `github.com`, `git.soma.salesforce.com`).
 * Presentation-only: unlike {@link SyncFilterMenu}'s repository scope, this
 * filter never changes what a sync re-checks — it only narrows what's shown.
 *
 * Lists every host present among the monitored PRs (not the connected/active
 * repository set — a host can have monitored PRs whose repo was since
 * disconnected). Portaled to `document.body` like {@link SyncFilterMenu} so it
 * escapes clipped/transformed ancestors.
 */

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { portal } from './portal.js';

interface Props {
  anchorRef: { current: HTMLElement | null };
  /** Every host present among the monitored PRs, in display order. */
  hosts: string[];
  /** Hosts currently selected as the filter; empty = All hosts. */
  selectedHosts: string[];
  onClose: () => void;
  /** Toggle a host in/out of the selection (empty selection = "All hosts"). */
  onToggleHost: (host: string) => void;
  onSelectAll: () => void;
  shortHost: (host: string) => string;
}

export function HostFilterMenu({
  anchorRef,
  hosts,
  selectedHosts,
  onClose,
  onToggleHost,
  onSelectAll,
  shortHost,
}: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, [anchorRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!pos || typeof document === 'undefined') return null;

  const allSelected = selectedHosts.length === 0;

  return portal(
    <>
      <div
        className="prm-project-menu-backdrop"
        onMouseDown={(e) => {
          e.stopPropagation();
          onClose();
        }}
      />
      <div
        className="prm-tile-menu prm-host-filter"
        style={{ position: 'fixed', top: pos.top, left: pos.left }}
        role="menu"
      >
        <div className="prm-sync-filter-header">
          <strong>Host</strong>
          <span className="prm-sync-filter-desc">Show PRs from specific git hosts.</span>
        </div>

        <button
          type="button"
          className={`prm-project-menu-item ${allSelected ? 'is-active' : ''}`}
          role="menuitemcheckbox"
          aria-checked={allSelected}
          onClick={(e) => {
            e.stopPropagation();
            onSelectAll();
          }}
          title="Show PRs from all hosts"
        >
          <span className="prm-sync-filter-check">{allSelected && <Check size={12} />}</span>
          All hosts
        </button>

        {hosts.map((h) => {
          const checked = selectedHosts.includes(h);
          return (
            <button
              key={h}
              type="button"
              className={`prm-project-menu-item ${checked ? 'is-active' : ''}`}
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={(e) => {
                e.stopPropagation();
                onToggleHost(h);
              }}
              title={`Filter to ${h}`}
            >
              <span className="prm-sync-filter-check">{checked && <Check size={12} />}</span>
              {shortHost(h)}
            </button>
          );
        })}
      </div>
    </>,
    document.body
  );
}
