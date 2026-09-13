import { Download } from 'lucide-react';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { PERMISSION_LABELS, pluginCapabilityLines } from '../../components/ExtensionConsent.js';
import { resolveIcon } from '../../lib/resolveIcon.js';
import { catalogRowAction, marketplaceProvenance, PluginCatalogCard } from './PluginCatalogCard.js';
import { entriesByAuthor } from './plugin-browse-discovery.js';

export function PluginMoreFromAuthor({
  entry,
  catalog,
  busy,
  errors,
  onOpen,
  onInstall
}: {
  entry: MarketplaceEntry;
  catalog: MarketplaceEntry[];
  busy?: Record<string, string>;
  errors?: Record<string, string>;
  onOpen: (next: MarketplaceEntry) => void;
  onInstall: (next: MarketplaceEntry) => void;
}) {
  const author = entry.author?.trim();
  if (!author) return null;
  const related = entriesByAuthor(catalog, author)
    .filter((row) => row.id !== entry.id)
    .slice(0, 4);
  if (related.length === 0) return null;
  return (
    <section className="settings-section" data-testid="plugin-more-from-author">
      <h3>More from {author}</h3>
      <div className="ext-browse-more-grid">
        {related.map((row) => (
          <PluginCatalogCard
            key={row.id}
            entry={row}
            busy={busy?.[row.id]}
            error={errors?.[row.id]}
            onOpen={() => onOpen(row)}
            onInstall={() => onInstall(row)}
          />
        ))}
      </div>
    </section>
  );
}

export function CatalogPluginDetail({
  entry,
  catalog,
  busy,
  error,
  onInstall,
  onOpenPlugin,
  onOpenAuthor
}: {
  entry: MarketplaceEntry;
  catalog: MarketplaceEntry[];
  busy?: string;
  error?: string;
  onInstall: (entry: MarketplaceEntry) => void;
  onOpenPlugin: (entry: MarketplaceEntry) => void;
  onOpenAuthor?: (author: string) => void;
}) {
  const Icon = resolveIcon(entry.icon ?? 'Package');
  const provenance = marketplaceProvenance(entry);
  const action = catalogRowAction(entry, busy);
  const capabilities = pluginCapabilityLines(entry);
  return (
    <div className="ext-catalog-detail" data-testid="catalog-plugin-detail">
      <header className="ext-catalog-detail-header">
        <span className="ext-browse-card-icon ext-catalog-detail-logo">
          <Icon size={22} />
        </span>
        <div className="ext-catalog-detail-heading">
          <h2>{entry.title}</h2>
          <div className="ext-catalog-detail-meta">
            <span className={`ext-market-item-source ext-market-item-source--${provenance}`}>
              {provenance === 'official' ? 'Official' : 'Community'}
            </span>
            {entry.category ? <span className="ext-browse-category-pill">{entry.category}</span> : null}
            {entry.author ? (
              onOpenAuthor ? (
                <button
                  type="button"
                  className="ext-browse-author-link"
                  onClick={() => onOpenAuthor(entry.author!)}
                >
                  By {entry.author}
                </button>
              ) : (
                <span className="ext-market-item-author">By {entry.author}</span>
              )
            ) : null}
            <span className="ext-market-item-version">v{entry.version}</span>
          </div>
        </div>
        <button
          type="button"
          className={`settings-btn ${action.primary ? 'primary' : ''}`}
          disabled={action.disabled}
          onClick={() => onInstall(entry)}
        >
          {action.icon ?? <Download size={14} />}
          {action.label}
        </button>
      </header>
      {error ? <p className="modal-error">{error}</p> : null}
      {entry.description ? <p className="ext-catalog-detail-lead">{entry.description}</p> : null}
      {capabilities.length > 0 || (entry.permissions && entry.permissions.length > 0) ? (
        <section className="settings-section" data-testid="plugin-includes">
          <h3>Includes</h3>
          {capabilities.length > 0 ? (
            <ul className="ext-hub-perm-list">
              {capabilities.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {entry.permissions && entry.permissions.length > 0 ? (
            <ul className="ext-hub-perm-list">
              {entry.permissions.map((perm) => (
                <li key={perm}>{PERMISSION_LABELS[perm] ?? perm}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <PluginMoreFromAuthor
        entry={entry}
        catalog={catalog}
        onOpen={onOpenPlugin}
        onInstall={onInstall}
      />
    </div>
  );
}
