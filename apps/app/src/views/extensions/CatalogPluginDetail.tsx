import { Download } from 'lucide-react';
import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import { PERMISSION_LABELS } from '../../components/ExtensionConsent.js';
import { resolveIcon } from '../../lib/resolveIcon.js';
import { catalogRowAction, marketplaceProvenance } from './PluginCatalogCard.js';
import { PluginOverviewMarkdown } from './PluginOverviewMarkdown.js';
import { entriesByAuthor } from './plugin-browse-discovery.js';

export function pluginMarketplaceLabel(entry: MarketplaceEntry): string {
  return marketplaceProvenance(entry) === 'official' ? 'Zana Official' : 'Community';
}

export function PluginOverviewLead({ description }: { description: string }) {
  return (
    <p className="ext-catalog-detail-lead" data-plugin-summary="">
      {description}
    </p>
  );
}

export function PluginMoreFromAuthor({
  entry,
  catalog,
  onOpen
}: {
  entry: MarketplaceEntry;
  catalog: MarketplaceEntry[];
  busy?: Record<string, string>;
  errors?: Record<string, string>;
  onOpen: (next: MarketplaceEntry) => void;
  onInstall?: (next: MarketplaceEntry) => void;
}) {
  const author = entry.author?.trim();
  if (!author) return null;
  const related = entriesByAuthor(catalog, author)
    .filter((row) => row.id !== entry.id)
    .slice(0, 4);
  if (related.length === 0) return null;
  return (
    <section className="ext-plugin-section" data-testid="plugin-more-from-author">
      <h3>More from this author</h3>
      <div className="ext-plugin-more-list">
        {related.map((row) => {
          const Icon = resolveIcon(row.icon ?? 'Package');
          return (
            <button
              key={row.id}
              type="button"
              className="ext-plugin-more-row"
              onClick={() => onOpen(row)}
              aria-label={`${row.title} plugin details`}
            >
              <span className="ext-browse-card-icon">
                <Icon size={16} />
              </span>
              <span className="ext-plugin-more-copy">
                <span className="ext-plugin-more-title">{row.title}</span>
                {row.description ? (
                  <span className="ext-plugin-more-desc">{row.description}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function PluginDetailsSection({ entry }: { entry: MarketplaceEntry }) {
  return (
    <section className="ext-plugin-section" data-testid="plugin-details">
      <h3>Details</h3>
      <dl className="ext-plugin-meta-grid">
        <div>
          <dt>Marketplace</dt>
          <dd>{pluginMarketplaceLabel(entry)}</dd>
        </div>
        {entry.version ? (
          <div>
            <dt>Version</dt>
            <dd>v{entry.version}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export function PluginReleaseSection({
  version,
  delivery = 'Updates with ZCC'
}: {
  version?: string;
  delivery?: string;
}) {
  if (!version && !delivery) return null;
  return (
    <section className="ext-plugin-section" data-testid="plugin-release">
      <h3>Release</h3>
      <dl className="ext-plugin-table">
        <div>
          <dt>Delivery</dt>
          <dd>{delivery}</dd>
        </div>
        {version ? (
          <div>
            <dt>Version</dt>
            <dd>{version}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export function PluginCapabilitiesSection({
  rows
}: {
  rows: Array<{ label: string; detail: string }>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="ext-plugin-section" data-testid="plugin-includes">
      <h3>Capabilities</h3>
      <dl className="ext-plugin-table">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function catalogCapabilityRows(entry: MarketplaceEntry): Array<{ label: string; detail: string }> {
  const rows: Array<{ label: string; detail: string }> = [];
  if (entry.skillNames?.length) {
    rows.push({ label: 'Skills', detail: entry.skillNames.join(', ') });
  }
  if (entry.mcpServers?.length) {
    rows.push({
      label: 'MCP',
      detail: entry.mcpServers.map((server) => `${server.name}${server.alwaysOn ? ' (always on)' : ''}`).join(', ')
    });
  }
  for (const perm of entry.permissions ?? []) {
    rows.push({ label: perm, detail: PERMISSION_LABELS[perm] ?? perm });
  }
  return rows;
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
  const capabilities = catalogCapabilityRows(entry);
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
          </div>
        </div>
        {action.label === 'Installed' && !entry.hasUpdate ? (
          <span className="ext-browse-installed-pill">
            {action.icon}
            Installed
          </span>
        ) : (
          <button
            type="button"
            className={`settings-btn ${action.primary ? 'primary' : ''}`}
            disabled={action.disabled}
            onClick={() => onInstall(entry)}
          >
            {action.icon ?? <Download size={14} />}
            {action.label}
          </button>
        )}
      </header>
      {error ? <p className="modal-error">{error}</p> : null}
      {entry.description ? <PluginOverviewLead description={entry.description} /> : null}
      <div className="ext-plugin-detail-stack">
        {entry.overview ? (
          <section className="ext-plugin-section" data-resource-detail-section="overview">
            <h3>Overview</h3>
            <PluginOverviewMarkdown markdown={entry.overview} />
          </section>
        ) : null}
        <PluginDetailsSection entry={entry} />
        <PluginMoreFromAuthor entry={entry} catalog={catalog} onOpen={onOpenPlugin} />
        <PluginReleaseSection version={entry.version} />
        <PluginCapabilitiesSection rows={capabilities} />
      </div>
    </div>
  );
}
