/**
 * "Sync & Filter" picker (R-LIST-002 / AC-LIST-2.2…2.8) — the dropdown half of
 * the header's split sync control.
 *
 * Lists an "All repositories" entry plus one entry per connected + active
 * repository (AC-LIST-2.3/2.8). The repository selection both (a) filters the
 * visible list to the chosen repos (AC-LIST-2.4) and (b) scopes what the
 * picker's sync action re-checks (AC-LIST-2.5). "Sync All" syncs everything
 * (AC-LIST-2.6); "Close" dismisses without changing the selection.
 *
 * Portaled to `document.body` like {@link PrProjectControl} so it escapes clipped/
 * transformed ancestors.
 */

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { ModuleHost } from './host.js';
import type { MonitoredRepo, ConnectionState } from '../../lib/types.js';
import { portal } from './portal.js';

type RepoRow = MonitoredRepo & { shortHost: string; connection: ConnectionState };

interface Props {
  anchorRef: { current: HTMLElement | null };
  host: ModuleHost;
  /** owner/repo full names currently selected as the filter/sync scope; empty = All. */
  selectedRepos: string[];
  onClose: () => void;
  /** Toggle a repo in/out of the selection (empty selection = "All repositories"). */
  onToggleRepo: (fullName: string) => void;
  onSelectAll: () => void;
  /** Sync exactly the current scope (all when nothing selected). */
  onSync: (fullNames: string[]) => void;
}

export function SyncFilterMenu({
  anchorRef,
  host,
  selectedRepos,
  onClose,
  onToggleRepo,
  onSelectAll,
  onSync,
}: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [repos, setRepos] = useState<RepoRow[]>([]);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.right });
  }, [anchorRef]);

  useEffect(() => {
    let alive = true;
    host
      .call<{ ok: boolean; repos?: RepoRow[] }>('listRepos')
      .then((res) => {
        // Connected + active only (AC-LIST-2.3/2.8): an active repo whose host is
        // disconnected can't be synced, so it must not appear as a scope option.
        if (alive) setRepos((res?.repos ?? []).filter((r) => r.active && r.connection === 'connected'));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [host]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!pos || typeof document === 'undefined') return null;

  const allSelected = selectedRepos.length === 0;

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
        className="prm-tile-menu prm-sync-filter"
        style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
        role="menu"
      >
        <div className="prm-sync-filter-header">
          <strong>Sync &amp; Filter</strong>
          <span className="prm-sync-filter-desc">Filter the list and choose what to sync.</span>
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
          title="Show and sync all repositories"
        >
          <span className="prm-sync-filter-check">{allSelected && <Check size={12} />}</span>
          All repositories
        </button>

        {repos.map((r) => {
          const fullName = `${r.owner}/${r.repo}`;
          const checked = selectedRepos.includes(fullName);
          return (
            <button
              key={`${r.host}|${fullName}`}
              type="button"
              className={`prm-project-menu-item ${checked ? 'is-active' : ''}`}
              role="menuitemcheckbox"
              aria-checked={checked}
              onClick={(e) => {
                e.stopPropagation();
                onToggleRepo(fullName);
              }}
              title={`Filter/sync ${fullName}`}
            >
              <span className="prm-sync-filter-check">{checked && <Check size={12} />}</span>
              {fullName} <span className="prm-sync-filter-host">({r.shortHost})</span>
            </button>
          );
        })}

        <div className="prm-tile-menu-divider" />

        <div className="prm-sync-filter-footer">
          <button type="button" className="prm-btn prm-btn--sm" onClick={onClose} title="Close without changing the selection">
            Close
          </button>
          <button
            type="button"
            className="prm-btn prm-btn--sm prm-btn--primary"
            onClick={() => {
              onSync(selectedRepos);
              onClose();
            }}
            title={allSelected ? 'Sync all repositories now' : 'Sync the selected repositories now'}
          >
            {allSelected ? 'Sync All' : `Sync ${selectedRepos.length}`}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
