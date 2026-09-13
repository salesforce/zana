import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Download } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { resolveIcon } from '../../lib/resolveIcon.js';

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
  const Icon = resolveIcon(entry.icon ?? 'Package');
  const action = catalogRowAction(entry, busy);
  const provenance = marketplaceProvenance(entry);
  const author = entry.author?.trim();
  return (
    <article className="ext-market-item ext-browse-card" data-testid={`plugin-card-${entry.id}`}>
      <div className="ext-browse-card-main">
        <button
          type="button"
          className="ext-browse-card-open"
          onClick={onOpen}
          aria-label={`${entry.title} plugin details`}
        >
          <span className="ext-browse-card-icon">
            <Icon size={18} />
          </span>
          <span className="ext-browse-card-body">
            <span className="ext-market-item-head">
              <span className="ext-market-item-title">{entry.title}</span>
              <span
                className={`ext-market-item-source ext-market-item-source--${provenance}`}
                title={
                  provenance === 'official'
                    ? 'First-party plugin shipped with the app'
                    : 'From a configured plugin catalog'
                }
              >
                {provenance === 'official' ? 'Official' : 'Community'}
              </span>
              {entry.hasUpdate && (
                <span className="ext-market-item-source ext-market-item-source--update">Update</span>
              )}
            </span>
            {entry.description ? <span className="ext-market-item-desc">{entry.description}</span> : null}
            {showCategory && entry.category ? (
              <span className="ext-browse-category-pill">{entry.category}</span>
            ) : null}
            {error ? <span className="modal-error">{error}</span> : null}
          </span>
        </button>
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
      </div>
      <div className="ext-market-item-action">
        <button
          type="button"
          className={`settings-btn ${action.primary ? 'primary' : ''}`}
          disabled={action.disabled}
          onClick={(event) => {
            event.stopPropagation();
            onInstall();
          }}
        >
          {action.icon}
          {action.label}
        </button>
      </div>
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
