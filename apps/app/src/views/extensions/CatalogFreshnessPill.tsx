/**
 * Browse → compact marketplace-source status. Healthy sources stay silent
 * behind one pill; out-of-date or failed sources turn it amber with an inline
 * Refresh. The popover lists every source (problems first) with per-source
 * refresh, so the toolbar stays one line regardless of how many catalogs are
 * configured.
 */
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { marketplaceCatalogFreshness, type MarketplaceCatalogRow } from '@zana-ai/zcc-domain';
import {
  catalogFreshnessDetail,
  sortCatalogsByFreshness,
  summarizeCatalogFreshness
} from './marketplace-catalogs.js';

export function CatalogFreshnessPill({
  catalogs,
  refreshing,
  now,
  onRefresh,
  onManage
}: {
  catalogs: MarketplaceCatalogRow[];
  /** Sources currently being refreshed. */
  refreshing: ReadonlySet<string>;
  now: number;
  onRefresh: (sources: string[]) => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (catalogs.length === 0) return null;
  const summary = summarizeCatalogFreshness(catalogs, now);
  const problems = catalogs
    .filter((row) => marketplaceCatalogFreshness(row, now) !== 'fresh')
    .map((row) => row.source);
  const busy = catalogs.filter((row) => refreshing.has(row.source)).length;
  const tone = busy ? 'busy' : summary.failed ? 'failed' : summary.stale ? 'stale' : 'fresh';
  const plural = (n: number) => (n === 1 ? 'source' : 'sources');
  const label = busy
    ? `Refreshing ${busy} of ${summary.total}…`
    : summary.failed || summary.stale
      ? [summary.stale && `${summary.stale} out of date`, summary.failed && `${summary.failed} failed`].filter(Boolean).join(' · ')
      : `${summary.total} ${plural(summary.total)} · up to date`;

  return (
    <div className="ext-catalog-fresh" ref={rootRef}>
      <div className={`ext-catalog-fresh-pill is-${tone}`}>
        <button
          ref={buttonRef}
          type="button"
          className="ext-catalog-fresh-toggle"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Marketplace sources: ${label}`}
          onClick={() => setOpen((v) => !v)}
        >
          {busy ? <RefreshCw size={12} className="ext-spin" /> : <span className="ext-catalog-fresh-dot" aria-hidden />}
          <span>{label}</span>
        </button>
        {!busy && problems.length > 0 && (
          <button type="button" className="ext-catalog-fresh-fix" onClick={() => onRefresh(problems)}>
            Refresh
          </button>
        )}
      </div>
      {open && (
        <div className="ext-catalog-fresh-pop" role="dialog" aria-label="Marketplace sources">
          <div className="ext-catalog-fresh-head">
            <span className="ext-catalog-fresh-title">Sources</span>
            <span className="ext-catalog-fresh-sub">
              {summary.total} · {problems.length ? `${problems.length} need attention` : 'all up to date'}
            </span>
            <button
              type="button"
              className="settings-btn"
              disabled={busy > 0}
              onClick={() => onRefresh(catalogs.map((row) => row.source))}
            >
              <RefreshCw size={13} />
              Refresh all
            </button>
          </div>
          <ul className="ext-catalog-fresh-list">
            {sortCatalogsByFreshness(catalogs, now).map((row) => {
              const state = refreshing.has(row.source) ? 'busy' : marketplaceCatalogFreshness(row, now);
              return (
                <li key={row.source} className={`ext-catalog-fresh-row is-${state}`}>
                  <span className="ext-catalog-fresh-dot" aria-hidden />
                  <div className="ext-catalog-fresh-body">
                    <div className="ext-catalog-fresh-name">{row.displayName}</div>
                    <div className="ext-catalog-fresh-detail" title={row.source}>
                      {state === 'busy' ? 'Refreshing…' : catalogFreshnessDetail(row, now)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ext-catalog-fresh-row-action"
                    disabled={state === 'busy'}
                    aria-label={`${state === 'failed' ? 'Retry' : 'Refresh'} ${row.displayName}`}
                    onClick={() => onRefresh([row.source])}
                  >
                    {state === 'failed' ? 'Retry' : <RefreshCw size={13} className={state === 'busy' ? 'ext-spin' : undefined} />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="ext-catalog-fresh-foot">
            <span>Out of date after 24 h · refreshed automatically</span>
            <button type="button" className="ext-catalog-fresh-manage" onClick={() => { setOpen(false); onManage(); }}>
              Manage…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
