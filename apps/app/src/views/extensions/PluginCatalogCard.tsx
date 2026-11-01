import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Download } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { catalogCapabilities } from './plugin-presentation.js';
import { PluginBrandIcon } from './PluginBrandIcon.js';

export function marketplaceProvenance(entry: MarketplaceEntry): 'official' | 'community' {
  return entry.source === 'bundled' || entry.tags?.includes('official') ? 'official' : 'community';
}

export function catalogRowAction(
  entry: MarketplaceEntry,
  busy?: string
): { label: string; disabled: boolean; primary: boolean; icon: ReactElement | null } {
  if (busy) return { label: busy, disabled: true, primary: false, icon: null };
  if (!entry.compatible) {
    return {
      label: 'Incompatible',
      disabled: true,
      primary: false,
      icon: <AlertTriangle size={14} />
    };
  }
  if (entry.hasUpdate) {
    return {
      label: 'Update',
      disabled: false,
      primary: true,
      icon: <ArrowUpCircle size={14} />
    };
  }
  if (entry.installed) {
    return {
      label: 'Installed',
      disabled: true,
      primary: false,
      icon: <CheckCircle2 size={14} />
    };
  }
  return {
    label: 'Install',
    disabled: false,
    primary: true,
    icon: <Download size={14} />
  };
}

export function PluginCatalogCard({
  entry,
  busy,
  error,
  showCategory = false,
  onOpen,
  onInstall,
  onOpenAuthor
}: {
  entry: MarketplaceEntry;
  busy?: string;
  error?: string;
  showCategory?: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onOpenAuthor?: (author: string) => void;
}) {
  const action = catalogRowAction(entry, busy);
  const provenance = marketplaceProvenance(entry);
  const author = entry.author?.trim();
  const capabilities = catalogCapabilities(entry);
  return (
    <article className="ext-market-item ext-browse-card" data-testid={`plugin-card-${entry.id}`}>
      <div className="ext-browse-card-main">
        <button
          type="button"
          className="ext-browse-card-open"
          onClick={onOpen}
          aria-label={`${entry.title} plugin details`}
        >
          <span className="ext-browse-card-icon" data-category={entry.category}>
            <PluginBrandIcon src={entry.iconUrl} icon={entry.icon ?? 'Package'} size={18} />
          </span>
          <span className="ext-browse-card-body">
            <span className="ext-market-item-head">
              <span className="ext-market-item-title">{entry.title}</span>
              {entry.hasUpdate && (
                <span className="ext-market-item-source ext-market-item-source--update">Update</span>
              )}
            </span>
            {showCategory && entry.category ? (
              <span className="ext-browse-card-category">{entry.category}</span>
            ) : null}
          </span>
          {entry.description ? <span className="ext-market-item-desc">{entry.description}</span> : null}
        </button>
        {capabilities.length > 0 ? <div className="ext-plugin-capabilities">{capabilities.map((cap) => <span key={cap}>{cap}</span>)}</div> : null}
        {error ? <p className="modal-error" role="alert">{error}</p> : null}
      </div>
      <footer className="ext-browse-card-footer">
        <div className="ext-browse-card-meta">
          {author ? (
            <span className="ext-browse-card-byline">
              By{' '}
              {onOpenAuthor ? (
                <button
                  type="button"
                  className="ext-browse-author-link"
                  onClick={() => onOpenAuthor(author)}
                >
                  {author}
                </button>
              ) : (
                author
              )}
            </span>
          ) : null}
          <span
            className="ext-browse-provenance"
            data-provenance={provenance}
            title={provenance === 'official' ? 'Official plugin' : 'From a configured plugin catalog'}
          >
            {provenance === 'official' ? 'Official' : 'Community'}
          </span>
        </div>
        <div className="ext-market-item-action">
          {action.label === 'Installed' && !entry.hasUpdate ? (
            <button type="button" className="settings-btn" onClick={onOpen}>{action.icon} Manage</button>
          ) : (
            <button
              type="button"
              className={`settings-btn${action.label === 'Update' ? ' primary' : ''}`}
              disabled={action.disabled}
              onClick={(event) => {
                event.stopPropagation();
                onInstall();
              }}
            >
              {action.label !== 'Install' ? action.icon : null}
              {action.label}
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

export function PluginCatalogGrid({
  entries,
  showCategory,
  busy,
  errors,
  onOpen,
  onInstall,
  onOpenAuthor,
  empty
}: {
  entries: MarketplaceEntry[];
  showCategory?: boolean;
  busy: Record<string, string>;
  errors: Record<string, string>;
  onOpen: (entry: MarketplaceEntry) => void;
  onInstall: (entry: MarketplaceEntry) => void;
  onOpenAuthor?: (author: string) => void;
  empty?: ReactNode;
}) {
  if (entries.length === 0) return <>{empty}</>;
  return (
    <div className="ext-browse-grid" data-testid="plugin-browse-grid">
      {entries.map((entry) => (
        <PluginCatalogCard
          key={entry.id}
          entry={entry}
          showCategory={showCategory}
          busy={busy[entry.id]}
          error={errors[entry.id]}
          onOpen={() => onOpen(entry)}
          onInstall={() => onInstall(entry)}
          onOpenAuthor={onOpenAuthor}
        />
      ))}
    </div>
  );
}
